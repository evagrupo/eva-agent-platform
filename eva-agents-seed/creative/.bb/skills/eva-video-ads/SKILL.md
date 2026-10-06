---
name: eva-video-ads
description: Produce motion-graphics video ads for EVA Salud and other EVA brands — vertical 1080×1920 Reels/Stories spots built in Remotion with brand typography and logos, photorealistic AI photos, a Castilian voice-over from the Iris (Eva) cloned voice with ElevenLabs Eleven v4 audio tags, generated music and sound effects, frame-accurate sync, a live browser preview and an H.264 render. Use whenever someone asks for an EVA video, vídeo, anuncio en vídeo, spot, Reel, Story, motion graphics, animated ad, a new hook or a new version of an existing video ad, a voice-over for it, or changes to timing, scenes, music or subtitles in one. Also use when editing the eva-salud-video project. Works in Codex, Claude Code, bb or any agent that reads skills.
---

# EVA video ads

Voice-over first → scenes timed to it → one pre-mixed soundtrack → live preview → render. Everything here was learned building the EVA Salud spot; the mistakes are documented so they are not repeated.

`$SKILL` = this skill's directory.

## Read what the task needs

| Task | Read |
|---|---|
| New project, preview, file layout | `references/project-setup.md` |
| Voice, music, effects, the mix | `references/audio-pipeline.md` |
| Frame math, word-level sync, scene table | `references/timing-and-sync.md` |
| Layout, components, scene grammar | `references/motion-design.md` |
| Checking work before showing it | `references/qa-checklist.md` |
| Something is broken | `references/troubleshooting.md` — read this first when debugging |
| Freezing a cut, rendering, emailing | `references/versioning-and-delivery.md` |
| Brand rules, logos, colours, tone | the `eva-brand` skill |
| Static ads, photo library, Meta policy | the `eva-salud-ads` skill |
| The same pipeline for a non-EVA brand | the `motion-video-ads` skill |

## Scripts

| Script | What it does |
|---|---|
| `scripts/tts.py` | Generate the voice-over (ElevenLabs **v4** + audio tags), verify with speech-to-text that tags were not spoken, print each line's length in seconds **and frames** |
| `scripts/sfx_music.py` | Generate the six UI sound effects and the music bed |
| `scripts/measure_speech.sh` | Word/phrase boundaries inside a line; leading silence inside an effect |
| `scripts/mix_audio.py` | Pre-mix VO + music + SFX into one `mix.mp3` (ducking, fades, effect-lead trimming) |
| `scripts/stills.sh` | Render frames + a contact sheet for fast visual review |
| `scripts/render.sh` | Render the mp4 and probe that it has video **and** audio |
| `scripts/verify_playback.sh` | Drive a real browser and prove the timecode advances |

`template/` is a working Remotion project (player, preloader, theme, component kit, eight example scenes, the six sound effects) — copy it and replace the content.

## Workflow

### 1. Write the script before anything moves
6–10 lines, one per scene, Castilian, `tú`, short. Structure that works: **problem (health first) → promise → how the AI works → confirmation → the user stays in control → breadth of service → warmth → download.** Only claims the product can keep.

### 2. Record and measure the voice
```bash
ELEVENLABS_API_KEY=... python3 $SKILL/scripts/tts.py lines.json public/audio/vo --fps 30
```
Iris (Eva) `XJBmyUY9wnUyXvpFfZul`, model **`eleven_v4`**, **one emotion per sentence segment** with qualifiers inside the same bracket (`[anxious, hushed]`, `[proud, warm]`), tags placed before the clause they direct, and `…` for real breaths. If a line does not land, swap the tag before rewriting the words. Keep `lines.json` in script order — `tts.py` passes neighbour lines as context. The script prints the frame length of every line and proves no tag was read aloud. **These numbers are the edit** — build the scene table from them, never the other way round.

### 3. Photos
Reuse the approved library in `eva-salud-ads/brand/fotos/`. For new ones, brief a Codex child (built-in image generation) with the realism rules from that skill — devices face their users, perfect hands, no text or screens — then **open every image yourself** before using it. A child reporting "fixed" is not evidence; check the file changed.

### 4. Build the scenes
Copy `template/`, then write one file per scene using the kit in `ui.tsx`. Time every element from the measured voice (`references/timing-and-sync.md`). Keep the scene table, the VO table and the SFX table together at the top of `Ad.tsx`.

### 5. Mix the audio into one file
```bash
python3 $SKILL/scripts/mix_audio.py timeline.json
```
One `<Audio src="audio/mix.mp3">` in the composition. Many `<Audio>` tags freeze the Player at 0:01 and look like a crash.

### 6. Check, then render
```bash
$SKILL/scripts/stills.sh Ad out/check 30 300 600 900 1200   # look at the sheet
$SKILL/scripts/verify_playback.sh                            # timecode must advance
$SKILL/scripts/render.sh Ad out/ad.mp4
```

### 7. Freeze and deliver
Freeze approved cuts into `src/remotion/vN/` with their own scenes, `ui.tsx` and audio mix, register them in `Root.tsx`, and keep the rendered file. Share the preview URL and the mp4; email one video per message.

## Rules that came from real feedback

- **The voice-over is the clock.** Cards, buttons and chips appear on the word that names them, in the order the sentence says them. Anything with no entrance animation is on screen from frame 0 and reads as a bug.
- **Give the hook room.** 1.6–2s per beat, one word and one graphic each. A three-image flurry in three seconds cannot be read.
- **Open on the problem, and make it obviously about health.** A fever at 03:10 reads instantly; a generic phone call does not.
- **Logo top-left, same size, every scene** (end card included). Enforced in the `Logo` component.
- **No transition sounds.** Whooshes on every cut sounded cheap. Effects only for taps, cards, notifications and confirmations, at 0.2–0.5 volume.
- **No glows, no fake-3D buttons.** Brand pills, flat colour, SVG arrows.
- **Fill the frame.** Big type, tight spacing, no large empty areas.
- **Expression, not narration.** `eleven_v4` with audio tags, one emotion per segment; `multilingual_v2` sounds flat and v3 drifts between takes.
- **Claims must be true.** If part of the catalogue is not included in the subscription, do not show it and qualify the claim on screen.
- **Verify before claiming.** Stills, a real browser, `ffprobe` on the rendered file. "Console is clean" proved nothing when the video was frozen.

## Agent notes: Codex vs Claude Code vs bb

| | **Codex** | **Claude Code** | **bb** |
|---|---|---|---|
| Install | `~/.codex/skills/` | `~/.claude/skills/` | `~/.bb/skills/` |
| New photos | Built-in image generation | OpenAI `gpt-image-2.5` via `eva-salud-ads/scripts/generate_image.py` (needs a key) | Delegate to a Codex child, then review yourself |
| Reviewing frames | Its image viewer | `Read` on the PNG; crop with PIL to zoom | Whichever provider runs |
| Browser playback check | `pinchtab` (or manual) | `pinchtab` | `pinchtab`; `bb remotion-player` for the panel preview |
| Sharing | local URL / folder | local URL / folder | `bb remotion-player` URL, `bb connect expose` for files |

Needs: Node 22+, Chrome/Chromium (Remotion renders with it), Python 3 with Pillow, and `ELEVENLABS_API_KEY` (in `erp-backend/.env` for EVA work). Rendering 40s at 1080×1920 takes a few minutes — render stills while iterating, the full file only when the cut is settled.
