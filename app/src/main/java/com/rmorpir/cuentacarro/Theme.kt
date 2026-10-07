package com.rmorpir.cuentacarro

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFF1C45B8),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE3EAFB),
    onPrimaryContainer = Color(0xFF15201C),
    secondaryContainer = Color(0xFFFFE9A0),
    onSecondaryContainer = Color(0xFF3A2C00),
    background = Color(0xFFF2F5F1),
    onBackground = Color(0xFF15201C),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF15201C),
    surfaceVariant = Color(0xFFE8EDE9),
    onSurfaceVariant = Color(0xFF586660),
    outline = Color(0xFFD5DDD7),
    outlineVariant = Color(0xFFD5DDD7),
    error = Color(0xFFC0262D),
    onError = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF2F5F1),
    surfaceContainerHigh = Color(0xFFF2F5F1),
    surfaceContainerHighest = Color(0xFFE8EDE9)
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF8FACFF),
    onPrimary = Color(0xFF0B1636),
    primaryContainer = Color(0xFF1E2A4D),
    onPrimaryContainer = Color(0xFFE7EEE9),
    secondaryContainer = Color(0xFF5A4700),
    onSecondaryContainer = Color(0xFFFFE9A0),
    background = Color(0xFF0F1512),
    onBackground = Color(0xFFE7EEE9),
    surface = Color(0xFF18211D),
    onSurface = Color(0xFFE7EEE9),
    surfaceVariant = Color(0xFF222D28),
    onSurfaceVariant = Color(0xFF9AA8A1),
    outline = Color(0xFF2A362F),
    outlineVariant = Color(0xFF2A362F),
    error = Color(0xFFFF7A80),
    onError = Color(0xFF3E1B1E),
    surfaceContainerLow = Color(0xFF18211D),
    surfaceContainer = Color(0xFF18211D),
    surfaceContainerHigh = Color(0xFF1F2A25),
    surfaceContainerHighest = Color(0xFF222D28)
)

@Composable
fun CuentaCarroTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(colorScheme = if (dark) DarkColors else LightColors, content = content)
}

/** Colores de estado y de oferta, con su versión para tema oscuro. */
object Pal {
    val promo = Color(0xFFFFD23F)
    val onPromo = Color(0xFF3A2C00)

    @Composable
    fun ok(): Color = if (isSystemInDarkTheme()) Color(0xFF5FCF92) else Color(0xFF1B7A4B)

    @Composable
    fun warn(): Color = if (isSystemInDarkTheme()) Color(0xFFF2B84B) else Color(0xFF8F5A00)

    @Composable
    fun over(): Color = if (isSystemInDarkTheme()) Color(0xFFFF7A80) else Color(0xFFC0262D)

    @Composable
    fun overSoft(): Color = if (isSystemInDarkTheme()) Color(0xFF3E1B1E) else Color(0xFFFBE0E1)

    @Composable
    fun okSoft(): Color = if (isSystemInDarkTheme()) Color(0xFF173326) else Color(0xFFDDF1E5)

    @Composable
    fun warnSoft(): Color = if (isSystemInDarkTheme()) Color(0xFF3A2C0F) else Color(0xFFFBEBC6)
}
