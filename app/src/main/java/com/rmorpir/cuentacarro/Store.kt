package com.rmorpir.cuentacarro

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class AppState(
    val items: List<Item> = emptyList(),
    val limitCents: Long? = 7000L,
    val ticket: String = ""
)

/** Producto que ya fotografiaste antes, localizado por su código de barras. */
data class Remembered(val name: String, val cents: Long, val kg: Boolean)

/** Guarda la lista y los ajustes en el propio móvil. */
class Store(context: Context) {
    private val sp = context.applicationContext
        .getSharedPreferences("cuentacarro", Context.MODE_PRIVATE)

    fun load(): AppState {
        val items = ArrayList<Item>()
        try {
            val arr = JSONArray(sp.getString("items", "[]"))
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val po = o.optJSONObject("promo")
                val promo = if (po == null) null else Promo(
                    PromoType.valueOf(po.getString("t")),
                    po.optInt("b"),
                    po.optInt("p"),
                    po.optDouble("c", 0.0)
                )
                items.add(
                    Item(
                        o.getString("id"),
                        o.getString("name"),
                        o.getLong("cents"),
                        o.getDouble("qty"),
                        o.optBoolean("kg"),
                        promo,
                        if (o.has("prev")) o.getLong("prev") else null
                    )
                )
            }
        } catch (e: Exception) {
            items.clear()
        }
        val l = sp.getLong("limit", 7000L)
        return AppState(items, if (l > 0L) l else null, sp.getString("ticket", "") ?: "")
    }

    fun save(s: AppState) {
        val arr = JSONArray()
        for (line in s.items) {
            val o = JSONObject()
            o.put("id", line.id)
            o.put("name", line.name)
            o.put("cents", line.cents)
            o.put("qty", line.qty)
            o.put("kg", line.kg)
            val pv = line.prevCents
            if (pv != null) o.put("prev", pv)
            val p = line.promo
            if (p != null) {
                val po = JSONObject()
                po.put("t", p.type.name)
                po.put("b", p.buy)
                po.put("p", p.pay)
                po.put("c", p.pct)
                o.put("promo", po)
            }
            arr.put(o)
        }
        sp.edit()
            .putString("items", arr.toString())
            .putLong("limit", s.limitCents ?: -1L)
            .putString("ticket", s.ticket)
            .apply()
    }

    fun recall(code: String): Remembered? {
        return try {
            val o = JSONObject(sp.getString("known", "{}")).optJSONObject(code) ?: return null
            Remembered(o.getString("n"), o.getLong("c"), o.optBoolean("k"))
        } catch (e: Exception) {
            null
        }
    }

    fun remember(code: String, name: String, cents: Long, kg: Boolean) {
        try {
            val all = JSONObject(sp.getString("known", "{}"))
            val o = JSONObject()
            o.put("n", name)
            o.put("c", cents)
            o.put("k", kg)
            all.put(code, o)
            sp.edit().putString("known", all.toString()).apply()
        } catch (e: Exception) {
            // Sin memoria de productos: no afecta a la lista.
        }
    }
}
