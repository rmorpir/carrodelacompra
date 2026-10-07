# Cuenta Carro

App de Android para controlar el gasto mientras haces la compra. Fotografías el cartel de un producto, la app lee el nombre y el precio en el propio móvil (sin internet y sin IA en la nube), eliges la cantidad y la oferta, y ves siempre cuánto llevas frente a tu tope de gasto.

## Qué hace

- **Foto del cartel.** Lee el texto con el reconocimiento de ML Kit, que va incluido en la app. Rellena nombre, precio y oferta; tú lo confirmas antes de añadirlo.
- **Ofertas.** 2x1, 3x2, otra NxM, 2ª unidad con el % que quieras y descuento en %. Al peso (€/kg) también.
- **Tope de gasto.** Aviso con vibración y banner al superarlo. La barra de abajo muestra siempre el total, lo que te queda y el avance.
- **Códigos de barras.** Si en la foto sale el código de barras, la app recuerda el último precio de ese producto. La próxima vez que lo añadas, la lista marca si ha subido (▲, en rojo) o bajado (▼, en verde) y cuánto.
- **Quitar un producto.** Con el botón "−" cuando solo queda una unidad, o desde la hoja del producto (Eliminar). Los dos permiten deshacer.
- **Ticket.** En el resumen escribes el total del ticket y te dice si coincide.

## Instalar en el móvil

1. En GitHub, entra en **Releases** y descarga `CuentaCarro.apk` de la última versión.
2. Ábrelo en el móvil. Android pedirá permitir la instalación desde el navegador o el gestor de archivos.
3. Las versiones nuevas se instalan encima de la anterior sin perder la lista.

## Compilar

Cada vez que se sube código a `main`, GitHub Actions compila el APK y lo publica en Releases. También puedes abrir el proyecto en Android Studio y generar el APK con **Build > Build APK(s)**.

Si quieres compilarlo a mano: `./gradlew assembleRelease` (el resultado queda en `app/build/outputs/apk/release/`).

## Nota sobre la firma

El APK se firma con la clave `app/debug.keystore`, que está en el repositorio a propósito: es una clave de uso personal, solo sirve para que las actualizaciones se instalen sobre la versión anterior. No uses esta clave para publicar en Google Play.
