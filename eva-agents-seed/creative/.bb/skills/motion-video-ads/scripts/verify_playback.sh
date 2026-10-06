#!/bin/bash
# Prove the preview actually PLAYS. A clean console is not proof: the Player can
# sit frozen at 0:01 while logging nothing (see references/troubleshooting.md).
# Drives a real browser and prints the timecode as it advances.
# Usage: verify_playback.sh [url=http://localhost:3000/] [samples=3] [gap=12]
set -e
URL=${1:-http://localhost:3000/}; N=${2:-3}; GAP=${3:-12}
export PINCHTAB_SESSION=$(pinchtab session create --agent-id videocheck | tail -1)
pinchtab nav "$URL" >/dev/null 2>&1
sleep 9
pinchtab click "text:Reproducir" >/dev/null 2>&1 || pinchtab click "text:Play" >/dev/null 2>&1 || true
for i in $(seq 1 "$N"); do
  sleep "$GAP"
  echo -n "t+$((i*GAP))s: "
  pinchtab text 2>&1 | grep -oE "[0-9]:[0-9]{2} / [0-9]:[0-9]{2}" | head -1
done
echo "timecode must increase; if it is stuck the composition is stalled, not slow"
