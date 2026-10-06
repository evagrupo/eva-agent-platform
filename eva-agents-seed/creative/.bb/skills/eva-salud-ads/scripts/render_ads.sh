#!/bin/bash
# Render every ad of a carousel page to max-quality PNGs + a ZIP + review sheets.
# Usage: render_ads.sh <page_url> <count> <png_out_dir> <prefix> [scale=2] [w=1080] [h=1350]
#   page_url  e.g. http://localhost:8765/index.html  (served over http, not file://)
#   prefix    must equal PNG_PREFIX in the page so the "Descargar" links work
# Output: <out>/<prefix>-N.png at w*scale × h*scale (2160×2700 by default, lossless),
#         <out>/<prefix>-todos.zip, <out>/_check/<prefix>-gridN.png (half-size 2x2 sheets for review).
# The page is opened with ?ad=N&hq=1: raw mode, scale 1, and photos swapped from
# img/web/*.jpg to the original img/ai/*.png so nothing is upscaled from a compressed JPG.
set -e
URL=$1; N=$2; OUT=$3; P=$4; SC=${5:-2}; W=${6:-1080}; H=${7:-1350}
mkdir -p "$OUT/_check"
# snap chromium cannot read/write /tmp or hidden dirs, so screenshot into a plain home dir
SHOTS="$HOME/meta-ads-tmp/shots"; mkdir -p "$SHOTS"
BIN=$(command -v chromium || command -v google-chrome || command -v chromium-browser || true)
[ -z "$BIN" ] && [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ] && BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -z "$BIN" ] && { echo "No Chrome/Chromium found"; exit 1; }
for n in $(seq 1 "$N"); do
  rm -f "$SHOTS/$P-$n.png"
  timeout 90 "$BIN" --headless=new --no-sandbox --hide-scrollbars --window-size=$W,$H \
    --force-device-scale-factor=$SC --virtual-time-budget=5000 \
    --screenshot="$SHOTS/$P-$n.png" "$URL?ad=$n&hq=1" >/dev/null 2>&1 || true
  [ -s "$SHOTS/$P-$n.png" ] || { echo "render failed: ad $n"; exit 1; }
  cp "$SHOTS/$P-$n.png" "$OUT/$P-$n.png"
done
python3 - "$OUT" "$P" "$N" <<'PY'
import sys, zipfile
from PIL import Image
out,p,n=sys.argv[1],sys.argv[2],int(sys.argv[3])
first=Image.open(f'{out}/{p}-1.png'); w,h=first.size
print('size',w,'x',h)
for g in range((n+3)//4):
    c=Image.new('RGB',(w//2,h//2),'white')
    for k in range(4):
        i=g*4+k+1
        if i>n: break
        c.paste(Image.open(f'{out}/{p}-{i}.png').resize((w//4,h//4)),((k%2)*(w//4),(k//2)*(h//4)))
    c.save(f'{out}/_check/{p}-grid{g+1}.png')
with zipfile.ZipFile(f'{out}/{p}-todos.zip','w',zipfile.ZIP_STORED) as z:
    for i in range(1,n+1): z.write(f'{out}/{p}-{i}.png',f'{p}-{i}.png')
print('ok',n,'ads, sheets',(n+3)//4)
PY
