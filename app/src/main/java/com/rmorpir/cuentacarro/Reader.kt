package com.rmorpir.cuentacarro

import android.content.Context
import android.graphics.Rect
import android.net.Uri
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min

// ---------- Texto reconocido, independiente de ML Kit ----------

data class OcrBox(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val height: Int get() = bottom - top
}

data class OcrElement(val text: String, val box: OcrBox)

data class OcrLine(val text: String, val box: OcrBox, val elements: List<OcrElement>)

/** Lo que se ha entendido del cartel. Todo lo que no se ha podido leer va a null. */
data class Reading(
    val name: String?,
    val priceCents: Long?,
    val kg: Boolean,
    val promo: Promo?,
    val candidates: List<Long>,
    val barcode: String?,
    val note: String?
)

// ---------- Expresiones para interpretar el texto ----------

private val PRICE_RE = Regex(
    """(?<![\d.,])(\d{1,3})\s?[,.]\s?(\d{2})(?!\d)(?!\s?(?:l|kg|g|ml|cl)\b)""",
    RegexOption.IGNORE_CASE
)

// Precio de referencia: "12,50 €/kg", "€ / l", "por kilo"...
private val REF_TAIL_RE = Regex(
    """/\s?(?:kg|kilo|l|litro|100\s?g|100\s?ml|ud|unidad)\b|\bpor\s+(?:kg|kilo|litro)\b""",
    RegexOption.IGNORE_CASE
)

// Etiquetas que van delante del precio de referencia: "precio kg: 12,50"
private val REF_HEAD_RE = Regex(
    """(?:precio|pvp)\s*(?:por\s*)?(?:kg|kilo|litro|l)\b\s*:?\s*$""",
    RegexOption.IGNORE_CASE
)

private val OLD_RE = Regex("""\b(?:antes|anterior|habitual)\b""", RegexOption.IGNORE_CASE)

private val NXM_RE = Regex(
    """(?<![\d.,])([2-4])\s?[x×]\s?([1-3])(?![\d.,])(?!\s?(?:g|kg|l|ml|cl|litro)\b)""",
    RegexOption.IGNORE_CASE
)
private val POR_RE = Regex("""(?<!\d)([2-4])\s?por\s?([1-3])(?!\d)""", RegexOption.IGNORE_CASE)
private val LLEVA_RE = Regex("""lleva\w*\s?([2-4])\D{0,15}?pag\w*\s?([1-3])""", RegexOption.IGNORE_CASE)

private val SECOND_A_RE = Regex(
    """(?:2\s?ª|2\.ª|segunda)\s?(?:unidad|ud\.?)?\D{0,20}?(\d{1,2})\s?%""",
    RegexOption.IGNORE_CASE
)
private val SECOND_B_RE = Regex(
    """(\d{1,2})\s?%\D{0,15}?(?:2\s?ª|segunda)""",
    RegexOption.IGNORE_CASE
)
private val PCT_A_RE = Regex("""[-−–]\s?(\d{1,2})\s?%""")
private val PCT_B_RE = Regex("""(\d{1,2})\s?%\s?(?:dto|desc)""", RegexOption.IGNORE_CASE)

private val NOISE_WORDS_RE = Regex(
    """\b(?:oferta|dto|descuento|ahora|antes|pvp|precio|iva|unidad|paga|lleva|cada|ahorra|hasta|stock)\b""",
    RegexOption.IGNORE_CASE
)

private class PriceCand(
    val cents: Long,
    val score: Double,
    val ref: Boolean,
    val kgRef: Boolean
)

// ---------- Interpretación del cartel ----------

fun parseLabel(lines: List<OcrLine>): Reading {
    val cands = ArrayList<PriceCand>()

    for (line in lines) {
        val text = line.text
        val lower = text.lowercase()
        val oldish = OLD_RE.containsMatchIn(lower)

        for (m in PRICE_RE.findAll(text)) {
            val value = m.groupValues[1].toLong() * 100L + m.groupValues[2].toLong()
            if (value <= 0L || value >= 100000L) continue

            val head = text.substring(0, m.range.first).lowercase()
            val tail = text.substring(m.range.last + 1).take(10).lowercase()
            val ref = REF_TAIL_RE.containsMatchIn(tail) || REF_HEAD_RE.containsMatchIn(head)
            val kgRef = ref && (tail.contains("kg") || tail.contains("kilo") ||
                head.takeLast(16).contains("kg") || head.takeLast(16).contains("kilo"))

            // Altura del número: cuanto más grande en el cartel, más probable que sea el precio de venta.
            val key = m.value.replace(" ", "")
            val el = line.elements.firstOrNull { it.text.replace(" ", "").contains(key) }
            val h = (el?.box?.height ?: line.box.height).toDouble()
            val score = h * (if (ref) 0.35 else 1.0) * (if (oldish) 0.55 else 1.0)
            cands.add(PriceCand(value, score, ref, kgRef))
        }

        // Precio partido: euros grandes y céntimos pequeños ("1" junto a "45")
        if (line.elements.size == 2) {
            val a = line.elements[0]
            val b = line.elements[1]
            val at = a.text.trim()
            val bt = b.text.trim()
            if (at.length in 1..3 && at.all { it.isDigit() } && bt.length == 2 && bt.all { it.isDigit() } &&
                b.box.height < a.box.height * 0.85
            ) {
                val value = at.toLong() * 100L + bt.toLong()
                if (value > 0L && value < 100000L) {
                    cands.add(PriceCand(value, a.box.height.toDouble(), false, false))
                }
            }
        }
    }

    val best = LinkedHashMap<Long, PriceCand>()
    for (c in cands) {
        val prev = best[c.cents]
        if (prev == null || c.score > prev.score) best[c.cents] = c
    }
    val sorted = best.values.sortedByDescending { it.score }
    val chosen = sorted.firstOrNull()

    val notes = ArrayList<String>()
    if (chosen != null) {
        if (chosen.ref && !chosen.kgRef) {
            notes.add("El precio elegido parece ser el de referencia por litro o unidad.")
        }
        if (chosen.kgRef) {
            notes.add("Parece un producto al peso (precio por kilo).")
        }
        if (sorted.size > 1 && sorted[1].cents != chosen.cents && sorted[1].score >= chosen.score * 0.75) {
            notes.add("Hay varios precios parecidos: elige el correcto.")
        }
    }

    val allText = lines.joinToString(" ") { it.text }.lowercase()
    val promo = detectPromo(allText)
    val name = extractName(lines)

    return Reading(
        name = name,
        priceCents = chosen?.cents,
        kg = chosen?.kgRef == true,
        promo = promo,
        candidates = sorted.take(5).map { it.cents },
        barcode = null,
        note = if (notes.isEmpty()) null else notes.joinToString(" ")
    )
}

private fun detectPromo(lower: String): Promo? {
    for (re in listOf(NXM_RE, POR_RE, LLEVA_RE)) {
        val m = re.find(lower) ?: continue
        val buy = m.groupValues[1].toInt()
        val pay = m.groupValues[2].toInt()
        if (buy > pay && pay >= 1) return Promo(PromoType.NXM, buy, pay)
    }
    val sa = SECOND_A_RE.find(lower) ?: SECOND_B_RE.find(lower)
    if (sa != null) {
        val pct = sa.groupValues[1].toDouble()
        if (pct in 5.0..90.0) return Promo(PromoType.SECOND, pct = pct)
    }
    val pm = PCT_A_RE.find(lower) ?: PCT_B_RE.find(lower)
    if (pm != null) {
        val pct = pm.groupValues[1].toDouble()
        if (pct in 5.0..90.0) return Promo(PromoType.PCT, pct = pct)
    }
    return null
}

private fun isNoise(text: String): Boolean {
    val t = text.lowercase()
    if (PRICE_RE.containsMatchIn(t)) return true
    if (t.contains("€") || t.contains("%")) return true
    if (REF_TAIL_RE.containsMatchIn(t)) return true
    if (NOISE_WORDS_RE.containsMatchIn(t)) return true
    if (NXM_RE.containsMatchIn(t) || POR_RE.containsMatchIn(t) || LLEVA_RE.containsMatchIn(t)) return true
    if (t.count { it.isLetter() } < 3) return true
    return false
}

private fun extractName(lines: List<OcrLine>): String? {
    val cand = lines.filter { it.box.height > 0 && !isNoise(it.text) }
    if (cand.isEmpty()) return null

    fun letters(l: OcrLine): Int = min(l.text.count { it.isLetter() }, 18)

    val best = cand.maxByOrNull { it.box.height * letters(it) } ?: return null
    val ordered = cand.sortedBy { it.box.top }
    val idx = ordered.indexOf(best)
    val bh = best.box.height
    var lo = idx
    var hi = idx
    while (lo > 0) {
        val a = ordered[lo - 1]
        val b = ordered[lo]
        if (a.box.height >= 0.6 * bh && b.box.top - a.box.bottom <= 1.5 * bh) lo-- else break
    }
    while (hi < ordered.size - 1) {
        val a = ordered[hi]
        val b = ordered[hi + 1]
        if (b.box.height >= 0.6 * bh && b.box.top - a.box.bottom <= 1.5 * bh) hi++ else break
    }
    val joined = ordered.subList(lo, hi + 1).joinToString(" ") { it.text.trim() }
    val pretty = prettify(joined)
    return if (pretty.isBlank()) null else pretty
}

private fun prettify(s: String): String {
    var t = s.replace(Regex("\\s+"), " ").trim()
    val letters = t.filter { it.isLetter() }
    if (letters.isNotEmpty() && letters.count { it.isUpperCase() } >= letters.length * 0.7) {
        t = t.lowercase().replaceFirstChar { it.uppercase() }
    }
    t = t.replace(Regex("(\\d)\\s?l\\b"), "\$1 L")
    return t.take(80)
}

// ---------- Conexión con ML Kit (todo en el móvil, sin internet) ----------

private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
}

private fun Rect?.toBox(): OcrBox =
    if (this == null) OcrBox(0, 0, 0, 0) else OcrBox(left, top, right, bottom)

suspend fun readLabel(context: Context, uri: Uri): Reading {
    val image = InputImage.fromFilePath(context, uri)
    val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val scanner = BarcodeScanning.getClient()
    try {
        val text = recognizer.process(image).awaitResult()
        val codes = try {
            scanner.process(image).awaitResult()
        } catch (e: Exception) {
            emptyList()
        }

        val lines = ArrayList<OcrLine>()
        for (block in text.textBlocks) {
            for (line in block.lines) {
                val els = line.elements.map { OcrElement(it.text, it.boundingBox.toBox()) }
                lines.add(OcrLine(line.text, line.boundingBox.toBox(), els))
            }
        }

        val code = codes.firstOrNull { !it.rawValue.isNullOrBlank() }?.rawValue
        return parseLabel(lines).copy(barcode = code)
    } finally {
        recognizer.close()
        scanner.close()
    }
}
