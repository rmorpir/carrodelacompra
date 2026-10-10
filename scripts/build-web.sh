#!/usr/bin/env bash
# Monta la carpeta dist/ con la web y el lector de carteles (OCR) para publicarla.
# Requiere haber ejecutado antes: npm install --prefix scripts
set -euo pipefail

BUILD_ID="${BUILD_ID:-local}"
NM="scripts/node_modules"
OUT="dist"

rm -rf "$OUT"
mkdir -p "$OUT/vendor/core" "$OUT/vendor/lang"
cp -r web/. "$OUT/"

# Motor de lectura (Tesseract) y su núcleo
cp "$NM/tesseract.js/dist/tesseract.min.js" "$OUT/vendor/"
cp "$NM/tesseract.js/dist/worker.min.js" "$OUT/vendor/"
CORE_DIR="$NM/tesseract.js-core"
shopt -s nullglob
core_files=("$CORE_DIR"/tesseract-core*lstm*)
if [ ${#core_files[@]} -eq 0 ]; then
  echo "No se encontraron los archivos del núcleo en $CORE_DIR" >&2
  ls -la "$CORE_DIR" >&2 || true
  exit 1
fi
cp "${core_files[@]}" "$OUT/vendor/core/"

# Datos de idioma (español)
LANGFILE="$(find "$NM/@tesseract.js-data/spa" -path '*4.0.0_best_int*' -name 'spa.traineddata.gz' | head -1)"
if [ -z "$LANGFILE" ]; then
  LANGFILE="$(find "$NM/@tesseract.js-data/spa" -name 'spa.traineddata.gz' | head -1)"
fi
if [ -z "$LANGFILE" ]; then
  echo "No se encontró spa.traineddata.gz" >&2
  find "$NM/@tesseract.js-data" -maxdepth 3 | head -40 >&2 || true
  exit 1
fi
cp "$LANGFILE" "$OUT/vendor/lang/spa.traineddata.gz"

# Número de versión para renovar la copia guardada en el móvil
sed -i "s/__BUILD__/${BUILD_ID}/g" "$OUT/sw.js"

echo "Versión: $BUILD_ID"
echo "Tamaños:"
du -sh "$OUT" "$OUT/vendor"/* "$OUT/vendor/core"/* "$OUT/vendor/lang"/* | sed 's/^/  /'

echo "::notice title=Tamaño de la web::$(du -sh "$OUT" | cut -f1) en total; $(du -sh "$OUT/vendor/lang" | cut -f1) de datos de español y $(du -sh "$OUT/vendor/core" | cut -f1) de núcleo del lector"
