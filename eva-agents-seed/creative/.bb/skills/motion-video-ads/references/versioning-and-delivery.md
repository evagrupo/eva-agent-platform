# Versions and delivery

## Freeze every approved cut
Clients ask for "a different hook, but keep the one I liked". A frozen version must be immune to later edits:

```bash
mkdir -p src/remotion/v2
cp src/remotion/Ad.tsx        src/remotion/v2/AdV2.tsx
cp -r src/remotion/scenes     src/remotion/v2/scenes
cp src/remotion/ui.tsx        src/remotion/v2/ui.tsx     # yes, its own copy
cp public/audio/mix.mp3       public/audio/mix-v2.mp3
cp mix_audio.py               mix_audio_v2.py
```
Then rename the exports (`AD_V2`, `AdV2`, `SCENES_V2`), point the copy at `mix-v2.mp3`, fix the relative imports (`../theme`, `../ui`), and register it in `Root.tsx`.

Copying `ui.tsx` matters: shared components are exactly how a "frozen" version silently changes later (a Logo or Phone fix would alter every old cut).

Keep the rendered file too: `out/ad-v2.mp4`.

## Rendering
```bash
scripts/render.sh Ad out/ad-v4.mp4
```
1080×1920, H.264 + AAC, ~12 MB for 40s. Check `ffprobe` shows both streams.

## Sharing
- Preview: `bb remotion-player` URL (live, hot-reloads).
- File: copy into a folder served over `bb connect expose` and give a markdown link.
- Email: any transactional provider (Resend works well) from a **verified sender domain**. **One video per email** — Gmail rejects attachments over 25 MB. Send the JSON body with `curl --data-binary @file` (urllib is 403'd by some WAFs), and write the body in the client's language, listing what changed and what still needs confirmation.
