package com.rmorpir.cuentacarro

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

enum class PromoType { NXM, SECOND, PCT }

/** Oferta ya traducida a números. NXM: te llevas [buy] y pagas [pay]. SECOND y PCT usan [pct]. */
data class Promo(
    val type: PromoType,
    val buy: Int = 0,
    val pay: Int = 0,
    val pct: Double = 0.0
)

data class Item(
    val id: String,
    val name: String,
    val cents: Long,
    val qty: Double,
    val kg: Boolean,
    val promo: Promo?
)

data class LineCalc(val gross: Long, val net: Long) {
    val save: Long get() = gross - net
}

/** Importe de una línea en céntimos, con la oferta aplicada. */
fun lineCalc(item: Item): LineCalc {
    val p = item.cents.toDouble()
    val q = item.qty
    val gross = (p * q).roundToLong()
    var net = gross
    val pr = item.promo
    if (pr != null) {
        when (pr.type) {
            PromoType.NXM -> {
                if (!item.kg && pr.buy >= 2 && pr.pay >= 1 && pr.pay < pr.buy) {
                    val groups = floor(q / pr.buy)
                    net = ((groups * pr.pay + (q - groups * pr.buy)) * p).roundToLong()
                }
            }
            PromoType.SECOND -> {
                if (!item.kg && pr.pct > 0 && pr.pct <= 100) {
                    val pairs = floor(q / 2)
                    net = (((q - pairs) + pairs * (1 - pr.pct / 100)) * p).roundToLong()
                }
            }
            PromoType.PCT -> {
                if (pr.pct > 0 && pr.pct <= 100) {
                    net = (gross * (1 - pr.pct / 100)).roundToLong()
                }
            }
        }
    }
    return LineCalc(gross, net)
}

data class Totals(val gross: Long, val net: Long, val units: Double, val lines: Int) {
    val save: Long get() = gross - net
}

fun totals(items: List<Item>): Totals {
    var gross = 0L
    var net = 0L
    var units = 0.0
    for (line in items) {
        val c = lineCalc(line)
        gross += c.gross
        net += c.net
        units += if (line.kg) 1.0 else line.qty
    }
    return Totals(gross, net, units, items.size)
}

// ---------- Formato y lectura de números (formato español) ----------

private val ES: Locale = Locale.forLanguageTag("es-ES")
private val currency: NumberFormat = NumberFormat.getCurrencyInstance(ES)

fun money(cents: Long): String = currency.format(cents / 100.0)

fun limitText(cents: Long): String =
    if (cents % 100L == 0L) "${cents / 100} €" else money(cents)

/** 145 -> "1,45" */
fun centsText(cents: Long): String = String.format(ES, "%d,%02d", cents / 100, cents % 100)

/** Para el campo del tope: 7000 -> "70", 7050 -> "70,50" */
fun centsToField(cents: Long): String =
    if (cents % 100L == 0L) (cents / 100).toString() else centsText(cents)

fun fmtQty(q: Double): String {
    val r = Math.round(q * 1000) / 1000.0
    return if (r == floor(r)) r.toLong().toString() else r.toString().replace('.', ',')
}

fun fmtPct(p: Double): String =
    if (p == floor(p)) p.toLong().toString() else p.toString().replace('.', ',')

fun parseNum(s: String): Double? {
    val v = s.trim().replace(" ", "").replace(',', '.').toDoubleOrNull() ?: return null
    return if (v.isFinite()) v else null
}

fun promoLabel(p: Promo): String = when (p.type) {
    PromoType.NXM -> "${p.buy}x${p.pay}"
    PromoType.SECOND -> "2ª al ${fmtPct(p.pct)}%"
    PromoType.PCT -> "−${fmtPct(p.pct)}%"
}
