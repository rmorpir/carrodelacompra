package com.rmorpir.cuentacarro

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import kotlinx.coroutines.launch
import java.io.File

/** Estado de la app: se guarda en el móvil cada vez que cambia. */
class AppModel(private val store: Store) {
    var state by mutableStateOf(store.load())
        private set

    fun update(block: (AppState) -> AppState) {
        state = block(state)
        store.save(state)
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = Store(applicationContext)
        setContent {
            CuentaCarroTheme {
                val model = remember { AppModel(store) }
                CarroScreen(model, store)
            }
        }
    }
}

@Composable
fun CarroScreen(model: AppModel, store: Store) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val haptic = LocalHapticFeedback.current

    var editing by remember { mutableStateOf<Draft?>(null) }
    var showSummary by remember { mutableStateOf(false) }
    var pendingPath by rememberSaveable { mutableStateOf<String?>(null) }
    var overDismissed by rememberSaveable { mutableStateOf(false) }

    val state = model.state
    val tot = totals(state.items)
    val limit = state.limitCents
    val over = limit != null && tot.net > limit

    // Aviso al cruzar el tope: vibración y banner.
    var prevOver by remember { mutableStateOf(over) }
    LaunchedEffect(over) {
        if (over && !prevOver) {
            overDismissed = false
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
        }
        if (!over) overDismissed = false
        prevOver = over
    }

    // ---- Cámara: la foto la hace la app de cámara del móvil ----
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val path = pendingPath
        if (ok && path != null) {
            val file = File(path)
            val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file)
            val d = Draft(null)
            d.photoPath = path
            d.status = "Leyendo el cartel…"
            editing = d
            scope.launch { runReading(ctx, store, d, uri, file) }
        }
    }

    fun launchCamera() {
        val dir = File(ctx.cacheDir, "images")
        dir.mkdirs()
        dir.listFiles()?.forEach { it.delete() }
        val file = File(dir, "cartel_" + System.currentTimeMillis() + ".jpg")
        pendingPath = file.absolutePath
        camera.launch(FileProvider.getUriForFile(ctx, ctx.packageName + ".fileprovider", file))
    }

    fun step(item: Item, dir: Int) {
        val st = if (item.kg) 0.1 else 1.0
        val q = Math.round((item.qty + dir * st) * 1000) / 1000.0
        if (q < st - 1e-9) return
        model.update { s -> s.copy(items = s.items.map { if (it.id == item.id) it.copy(qty = q) else it }) }
    }

    fun saveItem(d: Draft, item: Item) {
        model.update { s ->
            val exists = s.items.any { it.id == item.id }
            val list = if (exists) {
                s.items.map { if (it.id == item.id) item else it }
            } else {
                listOf(item) + s.items
            }
            s.copy(items = list)
        }
        d.barcode?.let { store.remember(it, item.name, item.cents, item.kg) }
        editing = null
    }

    fun deleteItem(id: String) {
        val idx = model.state.items.indexOfFirst { it.id == id }
        if (idx < 0) return
        val removed = model.state.items[idx]
        model.update { s -> s.copy(items = s.items.filter { it.id != id }) }
        editing = null
        scope.launch {
            val r = snackbar.showSnackbar(
                message = "Producto eliminado",
                actionLabel = "Deshacer",
                duration = SnackbarDuration.Short
            )
            if (r == SnackbarResult.ActionPerformed) {
                model.update { s ->
                    val list = s.items.toMutableList()
                    list.add(idx.coerceAtMost(list.size), removed)
                    s.copy(items = list)
                }
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = { TotalBar(tot.net, limit) { showSummary = true } }
    ) { pad ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(pad),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { Header(limit, over) { showSummary = true } }

            if (over && !overDismissed && limit != null) {
                item {
                    OverBanner(
                        "Has superado tu tope de ${limitText(limit)}. Llevas ${money(tot.net)}."
                    ) { overDismissed = true }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { launchCamera() },
                        modifier = Modifier.fillMaxWidth().height(64.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text("Fotografiar cartel", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    }
                    OutlinedButton(
                        onClick = { editing = Draft(null) },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text("Añadir a mano", fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            if (state.items.isEmpty()) {
                item { EmptyState() }
            } else {
                items(state.items, key = { row -> row.id }) { row ->
                    ItemRow(
                        item = row,
                        onEdit = { editing = draftFrom(row) },
                        onStep = { dir -> step(row, dir) }
                    )
                }
            }
        }
    }

    val d = editing
    if (d != null) {
        val editId = d.id
        ItemSheet(
            d = d,
            onDismiss = { editing = null },
            onSave = { item -> saveItem(d, item) },
            onDelete = if (editId == null) null else ({ deleteItem(editId) })
        )
    }

    if (showSummary) {
        SummarySheet(
            state = state,
            onDismiss = { showSummary = false },
            onLimit = { l -> model.update { s -> s.copy(limitCents = l) } },
            onTicket = { t -> model.update { s -> s.copy(ticket = t) } },
            onReset = {
                model.update { s -> s.copy(items = emptyList(), ticket = "") }
                showSummary = false
            }
        )
    }
}

@Composable
private fun Header(limit: Long?, over: Boolean, onLimit: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            "Cuenta Carro",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold
        )
        OutlinedButton(
            onClick = onLimit,
            shape = RoundedCornerShape(50),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = if (over) Pal.over() else MaterialTheme.colorScheme.onSurface
            ),
            border = BorderStroke(1.5.dp, if (over) Pal.over() else MaterialTheme.colorScheme.outline)
        ) {
            Text(
                if (limit != null) "Tope ${limitText(limit)}" else "Sin tope",
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium
            )
        }
    }
}

@Composable
private fun OverBanner(text: String, onOk: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = Pal.overSoft(),
        border = BorderStroke(1.5.dp, Pal.over())
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(text, color = Pal.over(), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(onClick = onOk) {
                Text("Entendido", color = Pal.over(), fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun EmptyState() {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.outline)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text("El carro está vacío", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text(
                "Haz una foto al cartel de un producto y añade la cantidad.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun PromoTag(label: String) {
    Box(
        modifier = Modifier
            .background(Pal.promo, RoundedCornerShape(4.dp, 10.dp, 4.dp, 10.dp))
            .padding(horizontal = 8.dp, vertical = 2.dp)
    ) {
        Text(
            label.uppercase(),
            color = Pal.onPromo,
            fontSize = 12.sp,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium
        )
    }
}

@Composable
private fun ItemRow(item: Item, onEdit: () -> Unit, onStep: (Int) -> Unit) {
    val c = lineCalc(item)
    val meta = if (item.kg) {
        fmtQty(item.qty) + " kg × " + money(item.cents) + "/kg"
    } else {
        fmtQty(item.qty) + " × " + money(item.cents)
    }
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable(onClick = onEdit),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(item.name, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            meta,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        val pr = item.promo
                        if (pr != null) PromoTag(promoLabel(pr))
                    }
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        money(c.net),
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Medium,
                        fontSize = 18.sp
                    )
                    if (c.save > 0) {
                        Text(
                            "−" + money(c.save),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = Pal.ok()
                        )
                    }
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedButton(
                    onClick = { onStep(-1) },
                    modifier = Modifier.size(44.dp),
                    contentPadding = PaddingValues(0.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("−", fontSize = 20.sp)
                }
                Text(
                    fmtQty(item.qty) + if (item.kg) " kg" else "",
                    modifier = Modifier.padding(horizontal = 6.dp),
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium
                )
                OutlinedButton(
                    onClick = { onStep(1) },
                    modifier = Modifier.size(44.dp),
                    contentPadding = PaddingValues(0.dp),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("+", fontSize = 20.sp)
                }
            }
        }
    }
}

/** Barra fija con el total acumulado, lo que queda del tope y el avance. */
@Composable
private fun TotalBar(net: Long, limit: Long?, onClick: () -> Unit) {
    val over = limit != null && net > limit
    val ratio = if (limit != null && limit > 0) net.toDouble() / limit else 0.0
    val color = when {
        limit == null -> MaterialTheme.colorScheme.primary
        over -> Pal.over()
        ratio >= 0.9 -> Pal.warn()
        else -> Pal.ok()
    }
    Surface(color = MaterialTheme.colorScheme.surface, shadowElevation = 12.dp) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Column {
                    Text(
                        "LLEVAS",
                        fontSize = 12.sp,
                        letterSpacing = 1.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        money(net),
                        fontSize = 40.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (over) Pal.over() else MaterialTheme.colorScheme.onSurface
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    if (limit != null) {
                        Text(
                            "Tope ${limitText(limit)}",
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            if (over) "Te pasas ${money(net - limit)}" else "Te quedan ${money(limit - net)}",
                            fontWeight = FontWeight.SemiBold,
                            color = color
                        )
                    } else {
                        Text(
                            "Sin tope",
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Text(
                        "Resumen ›",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
            if (limit != null) {
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { ratio.toFloat().coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(10.dp)
                        .clip(RoundedCornerShape(50)),
                    color = color,
                    trackColor = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}
