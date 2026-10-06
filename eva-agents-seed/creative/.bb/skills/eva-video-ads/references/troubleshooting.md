# Troubleshooting — every failure hit while building the EVA Salud ad, and the fix

These are real, reproduced bugs. Read this before debugging anything; most "the video is broken" reports are one of these.

## 1. The preview freezes at 0:01 and looks crashed
**Symptom:** the Player shows the first frames, the timecode sticks at 0:01 forever, console is clean.
**Cause:** the composition had ~30 separate `<Audio>` tags (voice lines + music + every effect). The Player waits for all media to buffer before advancing.
**Fix:** pre-mix everything into ONE `mix.mp3` with `scripts/mix_audio.py` and use a single `<Audio>`. Keep the VO/SFX tables in the source as documentation and regenerate the mix after any timing change.
**Lesson:** *a clean console is not proof of playback.* Always drive a real browser and watch the timecode advance (`scripts/verify_playback.sh`).

## 2. `Could not play audio` and a silent start
**Cause:** browsers block autoplay with sound.
**Fix:** don't `autoPlay`. Render a "▶ Reproducir con sonido" button that calls `player.seekTo(0); player.setVolume(1); player.play()` on click.

## 3. A counter showing `-1`
**Cause:** `interpolate(frame, [10, 86], [0, 7])` with only `extrapolateRight: "clamp"`; before frame 10 it extrapolates below the range.
**Fix:** always pass **both** `extrapolateLeft` and `extrapolateRight: "clamp"`, and clamp derived integers (`Math.max(0, Math.min(max, …))`). Audit every `interpolate` in the project when you find one.

## 4. Assets pop in during playback
**Cause:** images/fonts/audio decode lazily.
**Fix:** preload everything before mounting the Player (see `template/src/main.tsx`): decode every image, `document.fonts.ready`, buffer the mix, show a small progress bar, and time-box each file (~8s) so one slow asset can't block the preview.

## 5. A white flash at a cut
**Cause:** a photo scene sitting directly on the white root while the image paints.
**Fix:** give every photo scene a solid brand-coloured base `AbsoluteFill` behind the image, and don't fade the first beat's photo in from 0.

## 6. Two texts overlapping across a cut
**Cause:** beat A's text still rendered while beat B faded in (beats overlapping by a few frames).
**Fix:** each beat fades its own text out over the ~8 frames before its cut (`textOut`), and the next element starts after that.

## 7. Elements appearing before the voice mentions them
**Cause:** static elements with no entrance animation (the Cambiar/Cancelar buttons were on screen from frame 0).
**Fix:** everything that matters gets a `Pop`/`Reveal` with a delay derived from the voice line (see `timing-and-sync.md`). Nothing is on screen "for free".

## 8. Sound effects feel late
**Cause:** generated effects contain leading silence — measured 1.36s (ping), 1.60s (success), 1.20s (ring).
**Fix:** `mix_audio.py` trims each effect's lead with `atrim=start=<lead>,asetpts=PTS-STARTPTS` before delaying it. Verify with `scripts/measure_speech.sh <file> --lead`.

## 9. Marquee chips overlapping at the wrap point
**Cause 1:** a negative speed with `%` in JS yields a negative modulo → the row flies off-screen.
**Cause 2:** measuring the row width before the webfont loads gives a short period → chips overlap at the seam.
**Fix:** don't loop. Duplicate the list and translate linearly; over a 6–7s scene no wrap point is ever on screen.

## 10. The logo looks centred in some scenes
**Cause:** inside a flex column, `<Img>` stretches to full width and an SVG centres itself in the stretched box.
**Fix:** set `width: "auto"`, `alignSelf: "flex-start"`, `flexShrink: 0` **in the Logo component**, so no scene can drift.

## 11. An arrow that sits low/right inside a circular button
**Cause:** "→" is a text glyph on the font baseline with side bearings.
**Fix:** draw arrows as SVG (`Arrow` in `ui.tsx`). Same for any icon inside a circle.

## 12. A "fixed" asset that was never actually changed
**Cause:** an image-generation agent reported a fix but wrote the identical file (same byte size).
**Fix:** verify size/hash changed AND look at the file yourself. Never accept "done" as evidence.

## 13. Remotion's bundled ffmpeg rejects a filter
**Symptom:** `No such filter: 'afade'` / `'alimiter'`.
**Cause:** `npx remotion ffmpeg` ships a trimmed filter set (allowed: volume, atrim, adelay, apad, amix, asetpts, aresample, concat, silencedetect, loudnorm, pan…).
**Fix:** express fades and ducking as one `volume='…':eval=frame` expression; skip limiters, use `volume=0.9` after `amix`.

## 14. Headless Chrome can't read /tmp
**Cause:** snap-packaged Chromium is confined; `/tmp` and dotted directories are invisible to it.
**Fix:** screenshot into a plain home directory (`~/meta-ads-tmp`) and copy the file afterwards. Serve pages over `http://localhost`, never `file://`.

## 15. API calls 403 from Python but work with curl
**Cause:** a WAF (Cloudflare, error 1010) rejecting urllib's default user agent — hit on Resend and on ElevenLabs speech-to-text.
**Fix:** use `curl` for those calls (or set a normal User-Agent).

## 16. Email with the render bounces or is rejected
**Cause:** Gmail refuses attachments over 25 MB; three 12 MB videos in one email is too much.
**Fix:** one video per email, from a verified sender domain (`evaseguros.es` on the ERP's Resend key).

## 17. The music ends before the video
**Cause:** the cut got longer after re-recording the voice-over.
**Fix:** regenerate the bed at (final duration + ~1s). `mix_audio.py` prints a warning when the bed is too short.
