#!/bin/bash
# Usage: extract_isotype.sh <logo.svg> <css-class-or-fill-of-symbol-path> <out_prefix>
# Pulls the brand symbol path (e.g. the leaf) out of a full logo and writes
# <out_prefix>.svg (original color) and <out_prefix>-white.svg with a viewBox computed
# from the real bounding box (+4% padding) so the symbol is never cropped.
set -e
LOGO=$1; SEL=$2; PFX=$3
BIN=$(command -v chromium || command -v google-chrome || command -v chromium-browser)
D=$(python3 - "$LOGO" "$SEL" <<'PY'
import re,sys
s=open(sys.argv[1]).read();sel=sys.argv[2]
m=re.search(r'<path[^>]*(?:class="%s"|fill="%s")[^>]*\bd="([^"]+)"'%(re.escape(sel),re.escape(sel)),s)
print(m.group(1))
PY
)
TMP=$HOME/meta-ads-tmp/iso; mkdir -p "$TMP"
cat > "$TMP/b.html" <<H
<!doctype html><html><head><title>x</title></head><body><svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><path id="p" d="$D"/></svg>
<script>const b=document.getElementById('p').getBBox();document.title=[b.x,b.y,b.width,b.height].join(',')</script></body></html>
H
BOX=$(timeout 60 "$BIN" --headless=new --no-sandbox --virtual-time-budget=1000 --dump-dom "file://$TMP/b.html" 2>/dev/null | grep -o '<title>[^<]*' | sed 's/<title>//')
python3 - "$BOX" "$D" "$PFX" <<'PY'
import sys
x,y,w,h=map(float,sys.argv[1].split(','));d=sys.argv[2];p=sys.argv[3]
pad=max(w,h)*.04
vb=f"{x-pad:.2f} {y-pad:.2f} {w+2*pad:.2f} {h+2*pad:.2f}"
for suf,c in (("","#00983a"),("-white","#ffffff")):
    open(f"{p}{suf}.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><path fill="{c}" d="{d}"/></svg>')
print("viewBox",vb)
PY
