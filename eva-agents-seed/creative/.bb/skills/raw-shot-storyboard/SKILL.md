---
name: raw-shot-storyboard
description: Plan the raw footage for an AI-generated video before any generation — split a script into image-to-video shots, lock cast and continuity, draw simple stick-figure storyboard frames, typeset a storyboard sheet, get it approved, then record the dialogue with ElevenLabs Eleven v4 (one Castilian or other voice per character, fitting expression tags, QA'd against speech-to-text) and build a subtitled sketch video (animatic) with the voices so the whole conversation can be heard and watched before generating anything; also writes the generation sheet with a keyframe prompt and a motion prompt per shot for Seedance, Kling, Veo, Runway, Higgsfield or similar. Use whenever someone asks for a storyboard, shot list, shooting plan, "what should we generate", keyframes plan, or prompts for an AI video / UGC ad / talking-head / roleplay video, or wants voices for a roleplay, to audition voices, to hear or preview the dialogue, an animatic, an A/B of two voices, or to check that a video model will generate the right raw clips before editing. Covers ONLY what the video model generates — subtitles, graphics, UI and editing are out of scope (done later in Remotion or an editor). Works in Codex, Claude Code, bb or any agent that reads skills.
---

# Raw-shot storyboard

Script → shot list → stick-figure frames → storyboard sheet → **approval** → voices (Eleven v4) → sketch video with the voices → generation sheet. The output tells a video model **exactly which raw clips to generate**, so nothing is left to chance and nothing from the edit leaks into the footage.

`$SKILL` = this skill's directory. A complete worked example — a 12-shot, two-character phone-call roleplay — is in `examples/la-llamada/` (`shots.json`, `cast.json`, `storyboard.jpg`, `generation-sheet.md`). Open it before your first run.

## The one rule

**Storyboard only what the camera films.** No subtitles, badges, pills, speech bubbles, arrows, counters, icons, logos, prices or UI: not in the frames, not in the prompts. All of that belongs to the edit and is added on top later. If a script beat is carried purely by graphics (an app screen, a price card), the raw shot is still just the person — the graphic goes on top in the edit.

## Workflow

### 1. Break the script into raw shots
- **One clip = one action and at most one or two short lines**, 4–8s, never longer than about 10s. Split long speeches across two shots with different framing (medium → close-up) so the cut hides the join.
- Record the dialogue first if you can: the audio length decides each clip's length (clip = line + ~0.5s before + ~0.5s after).
- Alternate framings (medium, medium close-up, close-up) so the edit has variety.

### 2. Lock the cast and continuity (`cast.json`)
```json
{
  "format": "9:16",
  "characters": {
    "Marta": { "look": "…fixed physical description…", "props": "phone at her RIGHT ear, mug in her LEFT hand", "looks_toward": "frame-right" },
    "Elena": { "look": "…", "props": "headset with boom mic, pen in her RIGHT hand", "looks_toward": "frame-left" }
  },
  "locations": { "Cocina": "…window on the LEFT of frame…", "Oficina": "…" }
}
```
- **Screen direction:** in a two-person conversation, each character always looks toward the *same* side of the frame, opposite to the other one. That way they face each other across every cut. Only a deliberate direct-to-camera beat (usually the CTA) looks into the lens.
- **Props and hands:** fix which hand holds what and never change it.
- **Screens never readable:** a phone at the ear, a laptop closed or turned away.
- **Screen replacement:** when the edit will show real app UI on a device, generate that screen as flat, evenly lit **chroma green** so it can be keyed and replaced. Never let the model invent UI.
- **Cut-out presenter:** for green-screen layouts (presenter in a corner over graphics), generate the presenter in front of a flat chroma-green backdrop with even light and no green on the clothes.
- **Numbers, handwriting and signage** are drawn by the edit, not the model: a notepad stays blank while the pen moves, and streets have no readable signs.
- **Selfie shots:** the camera *is* the phone, so the phone is never in frame and the character looks into the lens.
- **Two different people read better than one actor playing both roles.** With AI, a second character costs nothing, and each face stays more consistent.

### 3. Write `shots.json`
One object per shot:

| field | meaning |
|---|---|
| `id` | `S01`, `S02`, … |
| `who`, `place` | a key from `cast.json` characters / locations |
| `frame` | framing size: close-up, medium close-up, medium… |
| `cam` | static, slow push-in, subtle handheld… |
| `dir` | gaze: frame-left / frame-right / into the lens |
| `action` | exactly what happens, in order, including the hands |
| `line` | the spoken line (empty for silent shots) |
| `emotion` | the delivery |
| `dur` | clip length, e.g. `"6 s"` |
| `vo` | `"off"` when the line is a voice-over (no lip-sync; the character does not speak) |
| `tags` | *optional* Eleven v4 audio tags for the line, e.g. `"curious, disbelief"`. If absent they are derived from `emotion` |
| `say` | *optional* how to pronounce the line when it differs from the subtitle, e.g. `"treinta y cuatro con cuarenta"` for `34,40` (some voices read the comma aloud) |
| `keyframe`, `motion` | *optional* hand-written prompts, which override the drafts |

The captions can be in the team's language. The prompts sent to the models work best in English: write `keyframe`/`motion` by hand for the final version (see the example's generation sheet).

### 4. Draw the stick-figure frames
```bash
python3 $SKILL/scripts/panel_brief.py <project>     # → <project>/PANEL-BRIEF.md
```
Give `PANEL-BRIEF.md` to an image generator. In bb, spawn a Codex child (built-in image generation) with *"Read PANEL-BRIEF.md and shots.json, draw panels/<id>.png for every shot, check each, report back"*, then wait for it without polling. Deliberately simple black-marker stick figures are the right fidelity: they are fast and consistent, and they make framing, gaze and props the only things to judge.

**Review every frame yourself** before moving on:
- the right character, and **gaze toward the correct side**
- props in the right hands
- the right framing size
- **no text, numbers, arrows, bubbles, icons or UI**
- only the CTA shot looks at the camera

Send precise fix notes for failures (the frame id, what's wrong, what it should show).

### 5. Render the storyboard sheet
```bash
python3 $SKILL/scripts/compose_sheet.py <project> --title "…" --subtitle "…" \
  --rule "Marta looks frame-right · Elena frame-left" --rule "Only S12 looks at camera" \
  [--lang en|es] [--aspect 9/16|16/9|1/1|4/5]
```
This writes `storyboard.png` plus `storyboard.html`. All words are typeset by the script — image models garble text, so captions are never drawn into the frames. Each card shows: shot id, clip length, a character and location chip, the dialogue, framing and camera, action, gaze and emotion.

### 6. Write the generation sheet
```bash
python3 $SKILL/scripts/generation_sheet.py <project> --title "…"   # → generation-sheet.md
```
It contains the global settings (format, handles, headroom, the "never" list), cast and location descriptions to paste into every prompt, the shot table, and a **keyframe prompt + motion prompt per shot**. The prompts are drafted from the fields; tighten them by hand (English, concrete, one action) or put overrides in `shots.json` and re-run.

### 7. Approval gate
**Stop here and get the storyboard approved** (the sheet from step 5). Recording voices before the script is final wastes work: every wording change moves every later timing. Check the claims too — for EVA scripts run them through `eva-salud-product`'s claim audit, and say plainly which lines promise something the product cannot keep.

### 8. Choose the voices
```bash
python3 $SKILL/scripts/find_voices.py --accent peninsular --gender female          # shortlist by role
# write candidates.json: {"Marta": [{"id": "...", "name": "..."}, ...], "Elena": [...]}
python3 $SKILL/scripts/voices.py <project> --samples candidates.json                # each candidate reads that character's first line
```
Give each character a clearly different voice (age, energy, register) and audition 2–3 on the real first line, not a demo sentence. You cannot judge a voice by ear as an agent: shortlist by metadata, then let the user listen and pick. When they ask for "two more", audition more candidates, never silently swap. Details and v4 tag rules: `references/voices-and-expressions.md`.

### 9. Record the dialogue
```bash
python3 $SKILL/scripts/voices.py <project> --voices voices.json --out versions/<name>
```
One call records every spoken line in script order with the right voice. Per line: expression tags (from `tags`, or mapped from `emotion`), neighbour lines as context across speakers, a speech-to-text check, and **automatic retakes with other seeds** if a word is dropped, doubled or a tag is read aloud. Lines that still differ are marked `<-- CHECK`; read the transcript in `takes.json` and decide. For an A/B of voices, pass `--reuse versionA:Elena` so the other character's takes stay identical and only one voice changes.

### 10. Build the sketch video (animatic)
```bash
python3 $SKILL/scripts/animatic.py <project> --out versions/<name> --title "…" --subtitle "…"
```
Trims dead air, matches loudness across voices (-16 LUFS), places lines on a turn-taking timeline (0.3 s between turns, no overlap), and renders `animatic.mp4` (your storyboard frames with subtitles, speaker chips and the clip length each shot needs), `call.mp3`, per-line audio and a listening page `index.html` where clicking a line jumps the video. Share that page with `python3 $SKILL/scripts/serve.py <folder> <port>` then `bb connect expose <port>`, on a folder holding only the version outputs. **Do not use `python -m http.server` for video:** it ignores HTTP Range requests, and with an mp4 whose index is at the end the browser cannot start playing (the pages "don't load" over a proxy). `animatic.py` writes mp4s with `+faststart` and `serve.py` answers Range requests; also give plain download links as a fallback. **Read the "clip needed" column**: spoken lines usually run longer than the planned clip, so tell the user which shots need longer clips before generating video.

### 11. Hand off
Production order (endpoints, limits, WAV-only audio and cost in `references/higgsfield-seedance-2.5.md`): approved lines and voices → character references and locations → keyframes (check props, hands, gaze) → image-to-video, 2–3 takes per shot → one clean mp4 per shot named by id. Clip length = line + ~0.5 s before + ~0.5 s after. **Whether the video model lip-syncs to the recorded lines is unverified** (Seedance 2.5 documents `audio_urls` only as a reference): run the one-shot test in `references/higgsfield-seedance-2.5.md` before generating a whole video, and upload audio as **WAV** (`norm/<id>.wav`), never MP3.

## Rules that make the clips usable in the edit
- **Handles:** ~0.5s in pose before the line and after it.
- **Headroom:** keep the face in the upper-middle. The top ~15% and bottom ~25% of a vertical frame stay free of the face, because subtitles, badges and platform UI go there later.
- **"No text" in every prompt,** keyframe and motion both.
- **Hands:** ask for "realistic hands with five fingers"; any hand gesture (counting, pointing) must stay fully in frame.
- **One action per clip.** Two actions produce mush — split the shot.
- **Pointing CTA:** the gesture points toward the bottom of the frame, where the platform button sits.

## Agent notes
| | Codex | Claude Code | bb |
|---|---|---|---|
| Stick-figure frames | Built-in image generation | An image API (e.g. OpenAI Images) with a user key, or ask the user to run the brief | Spawn a Codex child with `PANEL-BRIEF.md` |
| Reviewing frames | Image viewer | `Read` on the PNGs | Whichever provider runs |

Needs Python 3 with Pillow, Chrome/Chromium for the sheet render, an `ELEVENLABS_API_KEY` for voices (ask the user; never print it), and ffmpeg (system or Remotion's bundled `npx remotion ffmpeg`). Without Chrome, open `storyboard.html` in a browser.

Related: `eva-video-ads` / `motion-video-ads` build the edit on top of these clips. For EVA ads, use `eva-salud-product` to check claims before writing the lines.
