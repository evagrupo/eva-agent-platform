---
name: motion-video-ads
description: Produce motion-graphics video ads for any product or company — vertical 1080×1920 Reels/Stories/TikTok spots (or square/landscape) built in Remotion with the client's brand kit, photorealistic AI or stock photos, an AI voice-over with ElevenLabs Eleven v4 audio tags, generated music and sound effects, frame-accurate sync to the narration, a live browser preview and an H.264 render. Use whenever someone asks for a video ad, spot, commercial, Reel, Story, TikTok ad, animated or motion-graphics ad, an app promo video, a product launch video, a voice-over for one, a new hook, another version of an existing video, or changes to its timing, scenes, music or sound. For EVA brands prefer the eva-video-ads skill (brand and voice already bundled). Works in Codex, Claude Code, bb or any agent that reads skills.
---

# Motion-graphics video ads

Voice-over first → scenes timed to it → one pre-mixed soundtrack → live preview → render. The workflow, the component kit and the failure list come from shipping real ads; follow them and the first cut is already close.

`$SKILL` = this skill's directory. **For EVA brands use `eva-video-ads`** — same pipeline with the brand, voice and photo library built in.

## Read what the task needs

| Task | Read |
|---|---|
| New project, preview, file layout | `references/project-setup.md` |
| Voice, music, effects, the mix | `references/audio-pipeline.md` |
| Frame math, word-level sync, scene table | `references/timing-and-sync.md` |
| Layout, components, scene grammar | `references/motion-design.md` |
| Checking work before showing it | `references/qa-checklist.md` |
| Something is broken | `references/troubleshooting.md` — read this first when debugging |
| Freezing a cut, rendering, delivering | `references/versioning-and-delivery.md` |

## Scripts

| Script | What it does |
|---|---|
| `scripts/tts.py` | Generate the voice-over (ElevenLabs **v4** + audio tags), verify with speech-to-text that tags were not spoken, print each line in seconds **and frames** |
| `scripts/sfx_music.py` | Generate the six UI sound effects and a music bed of the right length |
| `scripts/measure_speech.sh` | Word/phrase boundaries inside a line; leading silence inside an effect |
| `scripts/mix_audio.py` | Pre-mix VO + music + SFX into one `mix.mp3` (ducking, fades, effect-lead trimming) |
| `scripts/stills.sh` | Render frames + a contact sheet for fast visual review |
| `scripts/render.sh` | Render the mp4 and probe that it has video **and** audio |
| `scripts/verify_playback.sh` | Drive a real browser and prove the timecode advances |

`template/` is a working Remotion project: player with asset preloading and click-to-play, `theme.ts` with brand tokens to replace, a component kit (`Reveal`, `Pop`, `Rise`, `Backdrop`, `Logo`, `Phone`, `Card`, `Cta`, `Arrow`, `PhotoZoom`), eight example scenes with placeholder copy, and six UI sound effects.

## Workflow

### 1. Brand and product facts first
Get the real logo SVGs, the licensed font, the exact colours, and a list of claims the product can actually keep (prices, coverage, timings). Put the colours in `theme.ts` and keep the claim list next to the script. Never approximate a brand from a screenshot.

### 2. Write the script before anything moves
6–10 lines, one per scene, in the audience's language, short and spoken-sounding. Structure that works:

**problem → promise → how it works → proof it worked → the user stays in control → breadth of the offer → a human moment → call to action.**

Open on the problem the product removes, made concrete (a specific moment, a number, a time of night) — not on the product.

### 3. Record and measure the voice
```bash
ELEVENLABS_API_KEY=... python3 $SKILL/scripts/tts.py lines.json public/audio/vo --voice <id> --fps 30
```
Use **`eleven_v4`** (not Turbo, which is for real-time agents) with one emotion per sentence segment, qualifiers in the same bracket (`[anxious, hushed]`), and `…` for real breaths; older models sound flat. Pick a voice native to the target language. The script prints every line's length in frames and proves no tag was read aloud. **Those numbers are the edit.**

### 4. Pictures
Use the client's photo library if there is one. For generated photos, brief an image model with strict realism rules — devices face their users, correct hands, no text or logos in frame, market-appropriate people, negative space where the copy goes — then **open every image yourself**. Never take "fixed" on trust; check the file actually changed.

### 5. Build the scenes
Copy `template/`, replace `theme.ts`, logos and copy, then write one file per scene with the kit in `ui.tsx`. Time every element from the measured voice (`references/timing-and-sync.md`). Keep the scene table, the VO table and the SFX table together at the top of `Ad.tsx`.

### 6. Mix the audio into one file
```bash
python3 $SKILL/scripts/mix_audio.py timeline.json
```
One `<Audio src="audio/mix.mp3">` in the composition. Many `<Audio>` tags freeze the Player at 0:01 and look exactly like a crash.

### 7. Check, then render
```bash
$SKILL/scripts/stills.sh Ad out/check 30 300 600 900 1200
$SKILL/scripts/verify_playback.sh
$SKILL/scripts/render.sh Ad out/ad.mp4
```

### 8. Freeze and deliver
Freeze approved cuts into `src/remotion/vN/` with their own scenes, `ui.tsx` and audio mix; register them in `Root.tsx`; keep the rendered file. Share the preview URL and the mp4, one video per email.

## Rules that came from real client feedback

- **The voice-over is the clock.** Cards, buttons and chips appear on the word that names them, in the order the sentence says them. Anything without an entrance animation is on screen from frame 0 and reads as a bug.
- **Give the hook room.** 1.6–2s per beat, one idea and one graphic each. Three images in three seconds cannot be read.
- **Open on the problem, concretely.** Abstract openings get skipped.
- **Logo same corner, same size, every scene.** Enforce it in the `Logo` component.
- **No transition sounds.** Whooshes on every cut sound cheap. Effects only for taps, cards, notifications and confirmations, at 0.2–0.5 volume.
- **No glows, no fake-3D buttons.** Flat brand shapes; arrows drawn as SVG, never a text glyph inside a circle.
- **Fill the frame.** Big type, tight spacing; a phone screen is small.
- **Expression, not narration.** `eleven_v4` with audio tags, natural pauses, one emotion per segment, a tone that matches the scene.
- **Claims must be true.** Show only what the offer really covers and qualify it on screen; get regulated-category copy approved.
- **Verify with your own eyes.** Stills, a real browser, `ffprobe` on the rendered file. "The console is clean" is not evidence that the video plays.

## Agent notes: Codex vs Claude Code vs bb

| | **Codex** | **Claude Code** | **bb** |
|---|---|---|---|
| Install | `~/.codex/skills/` | `~/.claude/skills/` | `~/.bb/skills/` |
| Generated photos | Built-in image generation | OpenAI Images API (needs a key from the user) | Delegate to a Codex child, then review yourself |
| Reviewing frames | Its image viewer | `Read` on the PNG; crop with PIL to zoom | Whichever provider runs |
| Playback check | `pinchtab` or a manual browser | `pinchtab` | `pinchtab`; `bb remotion-player` for the panel preview |
| Sharing | local URL / folder | local URL / folder | `bb remotion-player` URL, `bb connect expose` for files |

Needs: Node 22+, Chrome/Chromium (Remotion renders with it), Python 3 with Pillow, and an ElevenLabs API key for audio. Rendering 40s at 1080×1920 takes a few minutes — iterate on stills, render the file only when the cut is settled.
