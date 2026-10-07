@file:OptIn(ExperimentalMaterial3Api::class)

package com.rmorpir.cuentacarro

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.roundToLong

enum class PromoKey(val label: String, val unitOnly: Boolean) {
    NONE("Sin oferta", false),
    X2_1("2x1", true),
    X3_2("3x2", true),
    SECOND("2ª unidad", true),
    PCT("% dto.", false),
    NXM("Otra NxM", true)
}

/** Estado del formulario de producto. Cada campo es observable por Compose. */
class Draft(val id: String?) {
    private val newId: String = UUID.randomUUID().toString()

    var name by mutableStateOf("")
    var priceText by mutableStateOf("")
    var qtyText by mutableStateOf("1")
    var kg by mutableStateOf(false)
    var promoKey by mutableStateOf(PromoKey.NONE)
    var pctText by mutableStateOf("")
    var buyText by mutableStateOf("4")
    var payText by mutableStateOf("3")

    var photoPath: String? = null
    var thumb by mutableStateOf<ImageBitmap?>(null)
    var status by mutableStateOf<String?>(null)
    var statusKind by mutableStateOf(0) // 0 neutro, 1 correcto, 2 aviso
    var candidates by mutableStateOf<List<Long>>(emptyList())
    var barcode: String? = null

    // Precio de la última vez, si el producto se reconoció por su código de barras.
    var prevCents by mutableStateOf<Long?>(null)
    var prevKg by mutableStateOf(false)

    var touchedName = false
    var touchedPrice = false
    var touchedQty = false
    var touchedUnit = false
    var touchedPromo = false
    var touchedPct = false

    fun promo(): Promo? = when (promoKey) {
        PromoKey.NONE -> null
        PromoKey.X2_1 -> Promo(PromoType.NXM, 2, 1)
        PromoKey.X3_2 -> Promo(PromoType.NXM, 3, 2)
        PromoKey.NXM -> {
            val b = parseNum(buyText)?.roundToInt()
            val p = parseNum(payText)?.roundToInt()
            if (b != null && p != null && b >= 2 && p >= 1 && p < b) Promo(PromoType.NXM, b, p) else null
        }
        PromoKey.SECOND -> {
            val v = parseNum(pctText)
            if (v != null && v > 0 && v <= 100) Promo(PromoType.SECOND, pct = v) else null
        }
        PromoKey.PCT -> {
            val v = parseNum(pctText)
            if (v != null && v > 0 && v <= 100) Promo(PromoType.PCT, pct = v) else null
        }
    }

    /** El producto listo para guardar, o null si falta algo o no es válido. */
    fun toItem(): Item? {
        val price = parseNum(priceText) ?: return null
        var qty = parseNum(qtyText) ?: return null
        if (!kg) qty = max(1.0, qty.roundToInt().toDouble())
        val n = name.trim()
        if (n.isEmpty() || price <= 0.0 || price >= 10000.0 || qty <= 0.0 || qty >= 1000.0) return null
        var pr = promo()
        if (kg && pr != null && pr.type != PromoType.PCT) pr = null
        val cents = (price * 100).roundToLong()
        val prev = prevCents
        val keepPrev = if (prev != null && prevKg == kg && prev != cents) prev else null
        return Item(id ?: newId, n, cents, qty, kg, pr, keepPrev)
    }

    fun setUnit(toKg: Boolean) {
        touchedUnit = true
        kg = toKg
        val q = parseNum(qtyText)
        if (toKg) {
            if (promoKey != PromoKey.NONE && promoKey != PromoKey.PCT) promoKey = PromoKey.NONE
            if (!touchedQty && (q == null || q >= 1.0)) qtyText = "0,5"
        } else if (q != null && q > 0 && q != floor(q)) {
            qtyText = fmtQty(max(1.0, q.roundToInt().toDouble()))
        }
    }

    fun pickPromo(k: PromoKey) {
        touchedPromo = true
        promoKey = k
        if (k == PromoKey.SECOND && !touchedPct) pctText = "50"
        if (k == PromoKey.PCT && !touchedPct) pctText = "10"
    }

    fun bump(dir: Int) {
        val step = if (kg) 0.1 else 1.0
        var q = parseNum(qtyText) ?: 0.0
        q = Math.round((q + dir * step) * 1000) / 1000.0
        if (q < step) q = step
        qtyText = fmtQty(q)
        touchedQty = true
    }

    fun hint(): String {
        val item = toItem() ?: return ""
        val pr = item.promo
        if (pr == null) return if (item.kg) "Precio por kilo: indica los kilos que vas a llevar." else ""
        if (pr.type == PromoType.NXM && !item.kg) {
            if (item.qty < pr.buy) return "Con ${pr.buy} unidades pagas ${pr.pay}."
            val g = floor(item.qty / pr.buy)
            val pay = (g * pr.pay + (item.qty - g * pr.buy)).roundToInt()
            return "Pagas $pay de ${fmtQty(item.qty)} unidades."
        }
        if (pr.type == PromoType.SECOND && !item.kg) {
            if (item.qty < 2) return "Con 2 unidades, la segunda lleva un ${fmtPct(pr.pct)}% de descuento."
            val pairs = floor(item.qty / 2).roundToInt()
            val que = if (pairs == 1) "segunda unidad" else "segundas unidades"
            return "$pairs $que con ${fmtPct(pr.pct)}% de descuento."
        }
        if (pr.type == PromoType.PCT) return "Descuento del ${fmtPct(pr.pct)}% sobre el importe."
        return ""
    }
}

fun draftFrom(item: Item): Draft {
    val d = Draft(item.id)
    d.name = item.name
    d.priceText = centsText(item.cents)
    d.qtyText = fmtQty(item.qty)
    d.kg = item.kg
    d.prevCents = item.prevCents
    d.prevKg = item.kg
    val p = item.promo
    if (p != null) {
        when (p.type) {
            PromoType.NXM -> {
                d.promoKey = when {
                    p.buy == 3 && p.pay == 2 -> PromoKey.X3_2
                    p.buy == 2 && p.pay == 1 -> PromoKey.X2_1
                    else -> PromoKey.NXM
                }
                d.buyText = p.buy.toString()
                d.payText = p.pay.toString()
            }
            PromoType.SECOND -> {
                d.promoKey = PromoKey.SECOND
                d.pctText = fmtPct(p.pct)
            }
            PromoType.PCT -> {
                d.promoKey = PromoKey.PCT
                d.pctText = fmtPct(p.pct)
            }
        }
    }
    return d
}

// ---------- Lectura del cartel sobre el formulario ----------

private fun loadThumb(file: File): ImageBitmap? {
    return try {
        val opts = BitmapFactory.Options()
        opts.inSampleSize = 8
        val bmp = BitmapFactory.decodeFile(file.absolutePath, opts) ?: return null
        val orientation = ExifInterface(file.absolutePath)
            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        val deg = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        val out = if (deg == 0f) {
            bmp
        } else {
            val m = Matrix()
            m.postRotate(deg)
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        out.asImageBitmap()
    } catch (e: Exception) {
        null
    }
}

fun applyReading(d: Draft, r: Reading, rem: Remembered?) {
    d.barcode = r.barcode
    d.candidates = r.candidates

    val usedMemory = r.priceCents == null && rem != null
    val name = r.name ?: rem?.name
    val cents = r.priceCents ?: rem?.cents
    val toKg = r.kg || (r.priceCents == null && rem?.kg == true)

    if (name != null && !d.touchedName) d.name = name
    if (cents != null && !d.touchedPrice) d.priceText = centsText(cents)
    if (toKg && !d.touchedUnit) {
        d.kg = true
        if (!d.touchedQty) d.qtyText = "0,5"
    }

    val pr = r.promo
    if (pr != null && !d.touchedPromo) {
        when (pr.type) {
            PromoType.NXM -> if (!d.kg) {
                d.promoKey = when {
                    pr.buy == 3 && pr.pay == 2 -> PromoKey.X3_2
                    pr.buy == 2 && pr.pay == 1 -> PromoKey.X2_1
                    else -> PromoKey.NXM
                }
                d.buyText = pr.buy.toString()
                d.payText = pr.pay.toString()
            }
            PromoType.SECOND -> if (!d.kg) {
                d.promoKey = PromoKey.SECOND
                d.pctText = fmtPct(pr.pct)
            }
            PromoType.PCT -> {
                d.promoKey = PromoKey.PCT
                d.pctText = fmtPct(pr.pct)
            }
        }
    }

    d.prevCents = rem?.cents
    d.prevKg = rem?.kg == true

    var note = if (r.note.isNullOrBlank()) "" else " " + r.note
    if (rem != null && r.priceCents != null && rem.kg == d.kg && rem.cents != r.priceCents) {
        note += " Antes costaba " + money(rem.cents) + "."
    }
    if (name != null && cents != null) {
        d.status = if (usedMemory) {
            "Precio recordado de una compra anterior. Compruébalo." + note
        } else {
            "Leído del cartel. Comprueba el precio antes de añadir." + note
        }
        d.statusKind = 1
    } else {
        d.status = "No he podido leer todo el cartel. Completa lo que falta." + note
        d.statusKind = 2
    }
}

/** Carga la miniatura y lee el cartel con ML Kit, sin salir del móvil. */
suspend fun runReading(context: Context, store: Store, d: Draft, uri: Uri, file: File) {
    d.thumb = withContext(Dispatchers.IO) { loadThumb(file) }
    try {
        val r = readLabel(context, uri)
        val rem = r.barcode?.let { store.recall(it) }
        applyReading(d, r, rem)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        d.status = "No se pudo leer el cartel. Escribe los datos a mano."
        d.statusKind = 2
    }
}

// ---------- Hoja de producto ----------

@Composable
fun ItemSheet(
    d: Draft,
    onDismiss: () -> Unit,
    onSave: (Item) -> Unit,
    onDelete: (() -> Unit)?
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val item = d.toItem()
    val calc = if (item != null) lineCalc(item) else null
    val decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 16.dp)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                if (d.id == null) "Nuevo producto" else "Editar producto",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            if (d.photoPath != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val bmp = d.thumb
                    if (bmp != null) {
                        Image(
                            bitmap = bmp,
                            contentDescription = "Foto del cartel",
                            modifier = Modifier.size(76.dp).clip(RoundedCornerShape(8.dp)),
                            contentScale = ContentScale.Crop
                        )
                    }
                    val st = d.status
                    if (st != null) {
                        Text(
                            st,
                            fontSize = 14.sp,
                            modifier = Modifier.weight(1f),
                            fontWeight = if (d.statusKind == 0) FontWeight.Normal else FontWeight.SemiBold,
                            color = when (d.statusKind) {
                                1 -> Pal.ok()
                                2 -> Pal.warn()
                                else -> MaterialTheme.colorScheme.onSurface
                            }
                        )
                    }
                }
            }

            OutlinedTextField(
                value = d.name,
                onValueChange = { d.name = it; d.touchedName = true },
                label = { Text("Nombre") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth()
            )

            OutlinedTextField(
                value = d.priceText,
                onValueChange = { d.priceText = it; d.touchedPrice = true },
                label = { Text(if (d.kg) "Precio por kilo (€)" else "Precio (€)") },
                singleLine = true,
                keyboardOptions = decimal,
                modifier = Modifier.fillMaxWidth()
            )

            val prevC = d.prevCents
            val curC = parseNum(d.priceText)?.let { Math.round(it * 100) }
            if (prevC != null && d.prevKg == d.kg && curC != null && curC != prevC) {
                val diff = curC - prevC
                Text(
                    (if (diff > 0) "▲ Sube " else "▼ Baja ") + money(Math.abs(diff)) +
                        " respecto a la última vez (" + money(prevC) + ")",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (diff > 0) Pal.over() else Pal.ok()
                )
            }

            if (d.candidates.size > 1) {
                Text("Precios encontrados en el cartel", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    d.candidates.forEach { c ->
                        FilterChip(
                            selected = parseNum(d.priceText) != null && Math.round((parseNum(d.priceText) ?: 0.0) * 100) == c,
                            onClick = { d.priceText = centsText(c); d.touchedPrice = true },
                            label = { Text(money(c), fontFamily = FontFamily.Monospace) }
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                IconButton(onClick = { d.bump(-1) }) { Text("−", fontSize = 24.sp) }
                OutlinedTextField(
                    value = d.qtyText,
                    onValueChange = { d.qtyText = it; d.touchedQty = true },
                    label = { Text(if (d.kg) "Kilos" else "Cantidad") },
                    singleLine = true,
                    keyboardOptions = decimal,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = { d.bump(1) }) { Text("+", fontSize = 24.sp) }
            }

            Text("Se vende", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !d.kg, onClick = { d.setUnit(false) }, label = { Text("Por unidad") })
                FilterChip(selected = d.kg, onClick = { d.setUnit(true) }, label = { Text("Al peso (€/kg)") })
            }

            Text("Oferta", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                PromoKey.values().filter { !(d.kg && it.unitOnly) }.forEach { k ->
                    FilterChip(
                        selected = d.promoKey == k,
                        onClick = { d.pickPromo(k) },
                        label = { Text(k.label) }
                    )
                }
            }
            if (d.promoKey == PromoKey.SECOND || d.promoKey == PromoKey.PCT) {
                OutlinedTextField(
                    value = d.pctText,
                    onValueChange = { d.pctText = it; d.touchedPct = true },
                    label = {
                        Text(if (d.promoKey == PromoKey.SECOND) "Descuento en la 2ª unidad (%)" else "Descuento (%)")
                    },
                    singleLine = true,
                    keyboardOptions = decimal,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            if (d.promoKey == PromoKey.NXM) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        value = d.buyText,
                        onValueChange = { d.buyText = it },
                        label = { Text("Te llevas") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = d.payText,
                        onValueChange = { d.payText = it },
                        label = { Text("Pagas") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Bottom
                    ) {
                        Text("Total de esta línea", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(money(calc?.net ?: 0L), fontSize = 28.sp, fontWeight = FontWeight.Bold)
                    }
                    if (calc != null && calc.save > 0) {
                        Text(
                            "Ahorras ${money(calc.save)} con la oferta",
                            color = Pal.ok(),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp
                        )
                    }
                    val hint = d.hint()
                    if (hint.isNotEmpty()) {
                        Text(hint, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            Button(
                onClick = { if (item != null) onSave(item) },
                enabled = item != null,
                modifier = Modifier.fillMaxWidth().height(52.dp)
            ) {
                Text(if (d.id == null) "Añadir a la lista" else "Guardar cambios")
            }
            if (onDelete != null) {
                OutlinedButton(
                    onClick = onDelete,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Pal.over()),
                    border = BorderStroke(1.5.dp, Pal.over())
                ) {
                    Text("Eliminar producto")
                }
            }
        }
    }
}

// ---------- Hoja de resumen, tope y ticket ----------

@Composable
fun SummarySheet(
    state: AppState,
    onDismiss: () -> Unit,
    onLimit: (Long?) -> Unit,
    onTicket: (String) -> Unit,
    onReset: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val t = totals(state.items)
    var limitField by remember { mutableStateOf(state.limitCents?.let { centsToField(it) } ?: "") }
    var armed by remember { mutableStateOf(false) }
    val decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 16.dp)
                .padding(bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("Resumen y tope", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SummaryRow("Total", money(t.net), big = true)
                    SummaryRow("Sin ofertas", money(t.gross))
                    SummaryRow(
                        "Ahorro por ofertas",
                        if (t.save > 0) "−" + money(t.save) else money(0L),
                        good = true
                    )
                    SummaryRow(
                        "Productos",
                        "${t.lines} " + (if (t.lines == 1) "producto" else "productos") +
                            " · ${fmtQty(Math.round(t.units * 10) / 10.0)} uds"
                    )
                }
            }

            Text("Tope de gasto", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = limitField,
                    onValueChange = { v ->
                        limitField = v
                        val n = parseNum(v)
                        onLimit(if (n != null && n > 0 && n < 100000) (n * 100).roundToLong() else null)
                    },
                    label = { Text("Euros") },
                    singleLine = true,
                    keyboardOptions = decimal,
                    modifier = Modifier.weight(1f)
                )
                OutlinedButton(
                    onClick = { limitField = ""; onLimit(null) },
                    modifier = Modifier.height(56.dp)
                ) {
                    Text("Sin tope")
                }
            }

            Text("Total del ticket al pagar", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = state.ticket,
                onValueChange = onTicket,
                label = { Text("Euros") },
                singleLine = true,
                keyboardOptions = decimal,
                modifier = Modifier.fillMaxWidth()
            )
            val tk = parseNum(state.ticket)
            if (tk != null && tk >= 0 && state.ticket.isNotBlank()) {
                val diff = Math.round(tk * 100) - t.net
                if (diff == 0L) {
                    Surface(shape = RoundedCornerShape(10.dp), color = Pal.okSoft()) {
                        Text(
                            "El ticket coincide con tu total.",
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            color = Pal.ok(),
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                } else {
                    val dir = if (diff > 0) "más alto" else "más bajo"
                    Surface(shape = RoundedCornerShape(10.dp), color = Pal.warnSoft()) {
                        Text(
                            "El ticket es ${money(Math.abs(diff))} $dir que tu total. Revisa las ofertas y las cantidades.",
                            modifier = Modifier.fillMaxWidth().padding(12.dp),
                            color = Pal.warn(),
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
            OutlinedButton(
                onClick = {
                    if (armed) {
                        onReset()
                    } else {
                        armed = true
                    }
                },
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Pal.over()),
                border = BorderStroke(1.5.dp, Pal.over())
            ) {
                Text(if (armed) "Pulsa otra vez para vaciar la lista" else "Vaciar lista")
            }
        }
    }
}

@Composable
private fun SummaryRow(label: String, value: String, big: Boolean = false, good: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Bottom
    ) {
        Text(
            label,
            color = if (big) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = if (big) FontWeight.SemiBold else FontWeight.Normal
        )
        Text(
            value,
            fontFamily = if (big) FontFamily.Default else FontFamily.Monospace,
            fontSize = if (big) 30.sp else 16.sp,
            fontWeight = if (big) FontWeight.Bold else FontWeight.Medium,
            color = if (good) Pal.ok() else MaterialTheme.colorScheme.onSurface
        )
    }
}
