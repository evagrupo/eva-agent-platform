#!/bin/bash
# Word/phrase boundaries inside a voice line, and the silence baked into an effect.
# Animations are timed from THIS, never by ear or guesswork.
#
#   measure_speech.sh public/audio/v3/espec.mp3            # speech segments (fps 30 frames too)
#   measure_speech.sh public/audio/sfx/ping.mp3 --lead     # leading silence of an effect
set -e
F=$1; MODE=${2:-}
if [ "$MODE" = "--lead" ]; then
  LEAD=$(npx --yes remotion ffmpeg -i "$F" -af silencedetect=noise=-40dB:d=0.02 -f null - 2>&1 |
    grep -m1 "silence_end" | sed -E 's/.*silence_end: ([0-9.]+).*/\1/')
  echo "leading silence: ${LEAD:-0}s — mix_audio.py trims this so the effect lands on its frame"
  exit 0
fi
npx --yes remotion ffmpeg -i "$F" -af silencedetect=noise=-34dB:d=0.1 -f null - 2>&1 |
  grep -E "silence_(start|end)" |
  sed -E 's/.*silence_start: ([0-9.]+).*/gap starts \1s/; s/.*silence_end: ([0-9.]+).*/next words at \1s/' |
  awk '{ if ($0 ~ /next words at/) { split($0,a," "); f=a[4]; sub("s","",f); printf "%s  (frame %d @30fps)\n", $0, f*30 } else print }'
