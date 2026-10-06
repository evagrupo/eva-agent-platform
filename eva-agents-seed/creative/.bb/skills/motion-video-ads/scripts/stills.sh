#!/bin/bash
# Render single frames and build a contact sheet — the cheap way to check a cut
# without rendering the whole video (a full render is minutes, a still is seconds).
# Usage: stills.sh <composition> <out_dir> <frame> [frame...]
set -e
COMP=$1; OUT=$2; shift 2
mkdir -p "$OUT"
for f in "$@"; do
  npx remotion still src/remotion/index.ts "$COMP" "$OUT/f-$f.png" --frame="$f" --log=error >/dev/null
done
python3 - "$OUT" "$@" <<'PY'
import sys
from PIL import Image
out, frames = sys.argv[1], sys.argv[2:]
ims = [Image.open(f"{out}/f-{f}.png") for f in frames]
w, h = 260, round(260 * ims[0].size[1] / ims[0].size[0])
cols = min(6, len(ims)); rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols, h * rows), "white")
for i, im in enumerate(ims):
    sheet.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
sheet.save(f"{out}/_sheet.png")
print(f"{out}/_sheet.png", len(ims), "frames")
PY
