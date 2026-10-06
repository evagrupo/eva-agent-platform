#!/bin/bash
# Render a composition and verify the file really has video AND audio.
# Usage: render.sh <composition> <out.mp4>
set -e
COMP=$1; OUT=${2:-out/ad.mp4}
npx remotion render src/remotion/index.ts "$COMP" "$OUT" --log=error
echo "--- probe"
npx --yes remotion ffprobe "$OUT" 2>&1 | grep -E "Duration|Stream #"
ls -la "$OUT"
