# Generating the shots with Seedance 2.5 on Higgsfield (checked 2026-10-02)

Use the `higgsfield-api` skill for the mechanics (upload → estimate → run → download). This page records what was verified for **our** workflow, and what was not.

## Endpoints
| | `bytedance/seedance-2.5/image-to-video` | `bytedance/seedance-2.5/reference-to-video` |
|---|---|---|
| Inputs | `image_url` (required), optional `end_image_url`, `prompt` | at least one of `image_urls` (≤30), `video_urls` (≤10), `audio_urls` (≤10), ≤50 items total; `prompt` |
| First frame | output **follows the image's framing** | inputs are **references, not a promised first or last frame** |
| Aspect ratio | none (follows the image) | `16:9, 4:3, 1:1, 3:4, 9:16, 21:9` |
| Audio input | none | `audio_urls` (documented only as a reference) |
| Duration | integer **4–30 s** | integer **4–30 s** |
| Resolution | 480p, 720p, **1080p** (live docs) | 480p, 720p, **1080p** (live docs) |
| Other | `bitrate_mode` standard/high, `generate_audio` (default true) | same |

The bundled `model-catalog.json` (2026-09-25) lists only 480p/720p; the live model pages list 1080p. Trust the live page and rebuild the catalog with `refresh_catalog.py`.

## Rules that bite
- **Public HTTPS URLs only.** `asset://` is rejected. Upload with `higgsfield.py upload` and use the returned `public_url`.
- **Audio uploads must be WAV** (`audio/wav`, `audio/x-wav`). **MP3 is rejected** ("unsupported content type"). Use the loudness-matched `norm/<id>.wav` files that `animatic.py` writes, not the mp3s.
- Images: JPEG, PNG, WebP, GIF. Video: MP4.
- **Minimum clip is 4 s.** A 2.1 s line still needs a 4 s clip; trim in the edit.
- Durations are integers: round the "clip needed" column up.
- The docs give **no syntax for pointing at a specific reference inside the prompt** (no `@image1`). Refer to them in prose ("the first image is the character, the second the location") and test that it is respected.

## Cost (account estimate, before any discount)
Roughly **$0.2056 / s at 480p, $0.4622 / s at 720p, $1.1372 / s at 1080p** of generated video (16:9 pricing; image and audio references are not billed as video input, video references are and are billed on input + output duration). The estimate endpoint returns this formula, not a per-request number.
Example, V02 "La llamada" with every clip rounded up to whole seconds and the 4 s minimum (75 s of footage): 480p ≈ $15, **720p ≈ $35**, 1080p ≈ $85 per full set of takes. Budget 2–3 takes per shot.

## The open question: does audio drive lip-sync?
- Docs: `audio_urls` is listed as a reference; the example uses it for *atmosphere*. Nothing documents speech, voice or lip-sync from it, and `generate_audio` is described only as "generate audio with the video".
- The 82-workflow catalog has **no lip-sync, speech-to-video or avatar model**.
- So "record the lines first and the model lip-syncs to them" is **unverified**. Do not promise it.

**Test before generating a whole video** (one 6 s clip, ≈ $2.8 at 720p):
1. `reference-to-video` with the keyframe in `image_urls`, the line's WAV in `audio_urls`, 9:16, prompt describing the speaking action.
2. `image-to-video` with the same keyframe and a prompt that quotes the line, `generate_audio: true`.
3. Compare mouth movement against the recorded line, the voice that the model produces, and whether the keyframe's framing is kept.
Decide from the result: (a) audio reference works → use r2v; (b) the model speaks the quoted line itself in its own voice → keep our voice and replace the audio in the edit, accepting loose lip-sync; (c) neither → generate silent-ish video and use a separate lip-sync tool outside Higgsfield.

## Which endpoint for our workflow
- **Exact keyframe per shot, framing and props locked** (our storyboard approach) → **image-to-video** (`image_url`), because the output follows the image.
- **Character and location consistency across many shots from reference sheets, with 9:16 control and possibly the audio** → **reference-to-video**, accepting that the first frame is not guaranteed. Pass the character sheet and the location as `image_urls` and say which is which in the prompt.
