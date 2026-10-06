# Timing and sync — the part that makes the video feel professional

Everything is measured in **frames at 30 fps**. `seconds × 30 = frames`.

## The rule
**The voice-over is the clock.** Record it first, measure it, then lay the picture on top. Never animate first and hope the voice fits.

## 1. Measure every line
`scripts/tts.py` prints each line's length in seconds and frames. For lines where several elements must land on separate words, get the internal boundaries:

```bash
scripts/measure_speech.sh public/audio/v3/espec.mp3
# gap starts 1.94s / next words at 2.15s  (frame 64 @30fps) …
```

That is how the specialty cards land exactly on "dermatología… ginecología… pediatría": measured 0.00s / 0.95s / 2.15s, converted to frames, offset by where the line starts.

## 2. Build the scene table
One table drives the whole film (`Ad.tsx`):

```ts
export const SCENES = [
  { from: 0,    duration: 288, Component: Hook },   // 0.0–9.6s
  { from: 288,  duration: 180, Component: Frase },
  …
];
```
Rules:
- A scene's duration ≥ its voice line + ~0.6s of air.
- Voice lines live on their own timeline (`VO` table with absolute frames), never inside the scene `Sequence`, so a line may run a few frames past its cut without being clipped.
- Changing one line's length shifts every later scene — recompute the whole table, then re-run the mixer. Keep both in one commit.

## 3. Time the elements inside a scene
Delays are **local** to the scene (`frame - scene.from`). Recipe:
1. Note where the line starts inside the scene (e.g. scene at 936, line at 946 → offset 10).
2. Add the measured word offset in frames.
3. Give the element that delay; put the sound effect on the same frame.

Example (specialties, line at 946):
| element | word | offset | local delay |
|---|---|---|---|
| card 1 | dermatología 0.00s | 0 | 10 |
| card 2 | ginecología 0.95s | +29 | 39 |
| card 3 | pediatría 2.15s | +65 | 75 |
| "y muchas más" tile | 3.18s | +95 | 105 |
| CTA pill | "incluidas…" 4.34s | +130 | 140 |

## 4. Order beats the clock
If the voice says "cambia la cita **o** cancélala", the *Cambiar* button appears first, the *Cancelar* button second — never both at once, never before the sentence starts. Anything with no entrance animation is visible from frame 0, which always reads as a mistake.

## 5. Hook pacing
Give each hook beat **1.6–2s**, not 1s. One image, one word, one supporting graphic per beat, and a separate short voice line per beat so picture and voice land together. Four beats ≈ 8–9s is fine for a 40s ad; under ~1.2s per beat nobody can read it.

## 6. Sound effect timing
Effects go on the same frame as the animation they belong to, at 0.2–0.5 volume, and only for real interactions (tap, card, notification, confirmation). No transition whooshes — they were tried and sounded cheap and repetitive.
