# QA — what to check, and how, before showing anything

Checking is cheap; a wrong render costs minutes and credibility. Work in this order.

## 1. Types
`npx tsc --noEmit` after every edit round.

## 2. Stills (seconds, not minutes)
```bash
scripts/stills.sh Ad out/check 30 300 600 900 1200
```
Look at the contact sheet for: text over faces, overlapping text, elements appearing too early, empty cards (a missing photo shows as a blank tile), logo position, cropped symbols.

## 3. Zoom into details
Crop the 1080×1920 still to inspect small things — an arrow inside a circle, accents, the notch, a badge:
```python
Image.open("out/check/f-1200.png").crop((240,1020,900,1160)).resize((880,200)).save("zoom.png")
```

## 4. Playback in a real browser (non-negotiable)
```bash
scripts/verify_playback.sh
```
The timecode must increase. A frozen Player logs nothing — this is the only way to catch a stall (troubleshooting #1).

## 5. The rendered file
```bash
scripts/render.sh Ad out/ad.mp4
```
`ffprobe` output must show both streams and the expected duration. Pull a frame from the **rendered file** (not the preview) when checking a detail you just fixed:
```bash
npx --yes remotion ffmpeg -y -i out/ad.mp4 -ss 40 -frames:v 1 frame.png
```

## 6. Content review
- [ ] Voice matches what is on screen, word by word, in every scene.
- [ ] Elements enter in the order the voice names them.
- [ ] Logo top-left, same size, in every scene.
- [ ] No claim the product cannot keep; no personal-attribute health copy.
- [ ] Sound effects only on real interactions, none on transitions.
- [ ] Music audible between lines, ducked under them, ends with the video.
- [ ] Ad length: 30s is the sweet spot for Meta; past 40s expect drop-off.

## 7. Before saying "done"
Say what you verified and how (stills, browser playback, ffprobe). Never report a fix you have not seen with your own eyes — including fixes reported by a child agent.
