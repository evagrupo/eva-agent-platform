#!/bin/bash
# Usage: web_images.sh <src_dir_with_png> <out_dir> [width=1080]
# Converts AI PNGs into web-weight JPGs at ad width (keeps aspect).
set -e
SRC=$1; OUT=$2; W=${3:-1080}
mkdir -p "$OUT"
for f in "$SRC"/*.png "$SRC"/*.jpg "$SRC"/*.jpeg; do
  [ -f "$f" ] || continue
  b=$(basename "${f%.*}")
  python3 -c "
from PIL import Image
im=Image.open('$f').convert('RGB');w,h=im.size
im.resize(($W,round(h*$W/w)),Image.LANCZOS).save('$OUT/$b.jpg',quality=88)"
done
ls "$OUT"
