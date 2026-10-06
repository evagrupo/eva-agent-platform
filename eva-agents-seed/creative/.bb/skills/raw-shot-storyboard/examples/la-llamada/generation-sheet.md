---
title: Ángulo 2 · La llamada — hoja de generación (solo vídeo en bruto)
status: draft
owner: agent
updated: 2026-09-28
tags: [eva-salud, seedance, higgsfield, raw-footage]
---

# Angle 2 · "La llamada" — what the video model must generate

> [!NOTE] Scope
> This sheet covers **only the raw footage**: people, place, framing, action and lip-synced dialogue. Everything else — subtitles, badges, the app flow, logo, price, sounds and the end card — is added later in Remotion and is **deliberately absent here**. Generate clean shots with no text on screen.

**Storyboard (stick figures):** [angulo-2-raw.png](../storyboards/a2-raw/angulo-2-raw.png)

## Global settings

| | |
|---|---|
| Format | 9:16 vertical, generate at the highest resolution available (ideally 1080×1920), 24 fps |
| Clips | 12 clips, 4–8 s each; about 42 s once edited |
| Method | **Image first:** one keyframe per shot from the character references → Seedance 2.5 image-to-video |
| Dialogue | Record each line first (ElevenLabs, one voice per character), then drive lip-sync with that audio |
| Handles | Start every clip with ~0.5 s of the character already in pose **before** speaking, and end with ~0.5 s after the line; the edit trims them |
| Headroom | Head in the upper-middle of the frame, with space above it; the top ~15% and bottom ~25% stay free of the face because Remotion puts text there |
| Never | Text, logos, captions or subtitles in the image; a visible phone screen; looking into the lens (except S12) |

### The screen-direction rule (important for continuity)
**Marta always looks toward frame-right. Elena always looks toward frame-left.** That way the two women "face each other" across every cut, as if they were talking. Only in **S12** does Elena turn to look straight into the camera.

## Cast and locations (identical in every keyframe)

| | Description to use in every prompt |
|---|---|
| **Marta** (the customer) | Spanish woman, 38, curly dark hair in a loose bun, olive skin, small gold hoop earrings, oversized white T-shirt. Smartphone held to her **right** ear, ceramic mug in her **left** hand. |
| **Elena** (EVA advisor) | Spanish woman, 32, straight dark-brown hair down past the shoulders, light make-up, grey blazer over a white top, black headset with a boom mic. Pen in her right hand. |
| **Kitchen** | Bright Spanish kitchen in the morning: white tiles, light-wood worktop, window on the **left** of frame, plants, warm daylight. |
| **Office** | Modern open-plan office: wood-panelled wall, a green plant, a desk with a closed laptop and a notebook, soft even light. |

> [!TIP]
> Divina uses one actress for both roles to keep costs down. With AI it's clearer to use **two different women**, and it's easier to keep each one consistent. If you prefer the Divina trick, use the same face in two styles — but reusing one character reference for both makes consistency harder.

## Shots

| # | Character | Framing / camera | Action | Line (for lip-sync) | Clip |
|---|---|---|---|---|---|
| S01 | Marta | Medium close-up, static, eye level | Takes a sip, lowers the mug, opens her eyes in surprise | *¿Un seguro de salud para ocho personas… por 34,40 al mes?* | 5 s |
| S02 | Elena | Medium shot, seated, static | Leans slightly forward, pen in her hand | *Así es. Con Eva Salud metes a toda tu familia en una sola póliza.* | 6 s |
| S03 | Marta | Medium close-up, static | Tilts her head, raises the hand holding the mug as if asking | *¿Y qué me incluye?* | 4 s |
| S04 | Elena | Medium shot, hands in front of her chest | Counts on her fingers, one finger per word | *Medicina general, pediatría para los peques, ginecología, dermatología, traumatología… sin límite de consultas.* | 8 s |
| S05 | Elena | Tighter medium close-up, slow push-in | Lowers her hands to the desk and smiles | *Y videoconsulta las veinticuatro horas.* | 4 s |
| S06 | Marta | Medium close-up, static | Rolls her eyes, puts the mug down and leans on the worktop | *Vale… pero lo que yo odio es llamar a la clínica.* | 5 s |
| S07 | Elena | Medium shot, static | Puts the pen down, open gesture with her right hand | *Por eso no llamas tú. Le dices a Eva qué necesitas y cuándo puedes…* | 6 s |
| S08 | Elena | Close-up (shoulders and face) | Nods slowly as she talks, a short smile at the end | *…y ella contacta con los centros. Te avisa cuando la cita está confirmada.* | 6 s |
| S09 | Marta | Medium close-up, static | Touches her neck, looks upward, thoughtful | *¿Y si luego no me viene bien?* | 4 s |
| S10 | Elena | Medium shot, static | Nods with authority, hands together on the desk | *La cambias o la cancelas desde la app. Sin llamar.* | 5 s |
| S11 | Marta | Medium close-up, static | Relieved smile, nods, picks up the mug | *¡Vaya! Es justo lo que buscaba.* | 4 s |
| S12 | Elena | Medium shot, static | **Turns to camera**, open hand towards the lens, then points **down** with her index finger | *¿Y tú? ¿Sigues llamando? Descárgate Eva Salud aquí abajo.* | 6 s |

## Prompts per shot

Each shot has two prompts: the **keyframe** (still image, with the character reference attached) and the **motion** prompt (Seedance image-to-video). They're written in English because the models follow English better; the dialogue goes in as audio for lip-sync.

<details>
<summary>S01 · Marta · sorprendida</summary>

**Keyframe:** Vertical 9:16 photo, medium close-up of Marta (see cast) standing in a bright Spanish kitchen, window on the left of frame, holding a smartphone to her right ear and a ceramic mug in her left hand near her lips, looking toward the right side of the frame, natural morning light, realistic skin texture, 35mm, shallow depth of field, no text.

**Motion:** She takes a small sip from the mug, lowers it, and her eyebrows rise in surprise as she speaks into the phone; subtle handheld sway; she keeps looking frame-right, never at the camera. Natural blinking, realistic lip movement.
</details>

<details>
<summary>S02 · Elena · segura</summary>

**Keyframe:** Vertical 9:16 photo, medium shot of Elena (see cast) seated at a desk in a modern office with wood-panelled wall and a green plant, black headset with boom mic, pen in her right hand, closed laptop, looking toward the left side of the frame, soft even light, no text.

**Motion:** She leans slightly forward and speaks warmly and confidently, small emphasis gesture with the pen; static camera; she looks frame-left the whole time.
</details>

<details>
<summary>S03 · Marta · curiosa</summary>

**Keyframe:** Same kitchen and framing as S01, Marta with phone at right ear, mug in left hand held at chest height, head tilted, curious expression, looking frame-right, no text.

**Motion:** She tilts her head and turns the mug hand slightly outward in a questioning gesture while asking a short question; static camera.
</details>

<details>
<summary>S04 · Elena · cuenta con los dedos</summary>

**Keyframe:** Same office as S02, medium shot, Elena holding her left hand up in front of her chest with fingers spread, right index finger touching her left thumb, mid-sentence, looking frame-left, no text.

**Motion:** She counts off five items on her left hand, touching one finger at a time with her right index finger, rhythmic and clear, nodding slightly on each; static camera; hands stay fully in frame with five fingers each.
</details>

<details>
<summary>S05 · Elena · push-in</summary>

**Keyframe:** Medium close-up of Elena in the same office, hands resting on the desk, gentle smile, looking frame-left, no text.

**Motion:** Slow push-in toward her face while she says one short sentence and finishes with a warm smile.
</details>

<details>
<summary>S06 · Marta · hastiada</summary>

**Keyframe:** Same kitchen as S01, Marta leaning her forearm on the worktop, mug set down beside her, phone at right ear, eyes rolled upward in playful annoyance, looking frame-right, no text.

**Motion:** She rolls her eyes, sets the mug on the worktop and leans on it while complaining with humour; static camera.
</details>

<details>
<summary>S07 · Elena · tranquilizadora</summary>

**Keyframe:** Same office, medium shot, Elena placing the pen down on the notebook, right hand opening in a calm gesture, reassuring smile, looking frame-left, no text.

**Motion:** She puts the pen down and explains calmly with an open right-hand gesture; static camera.
</details>

<details>
<summary>S08 · Elena · primer plano</summary>

**Keyframe:** Close-up of Elena (shoulders and face), headset visible, confident friendly expression, looking frame-left, no text.

**Motion:** She nods slowly while speaking two short sentences and ends with a brief smile; static camera.
</details>

<details>
<summary>S09 · Marta · dudosa</summary>

**Keyframe:** Same kitchen, Marta touching the side of her neck with her left hand, eyes looking up and to the right, thoughtful, phone at right ear, no text.

**Motion:** She pauses, touches her neck and looks up while asking a doubtful question; static camera.
</details>

<details>
<summary>S10 · Elena · asiente</summary>

**Keyframe:** Same office, medium shot, Elena with hands clasped on the desk, calm authoritative expression, looking frame-left, no text.

**Motion:** She nods firmly once while giving a short, confident answer; static camera.
</details>

<details>
<summary>S11 · Marta · aliviada</summary>

**Keyframe:** Same kitchen, Marta smiling with relief, picking the mug back up, phone at right ear, looking frame-right, no text.

**Motion:** She smiles, nods and lifts the mug while saying a short happy line; static camera.
</details>

<details>
<summary>S12 · Elena · a cámara</summary>

**Keyframe:** Same office, medium shot, Elena turned toward the camera, looking straight into the lens, right hand open toward the viewer, friendly knowing smile, no text.

**Motion:** She turns from frame-left to look straight into the camera, speaks to the viewer with an open hand, and on the last sentence points downward with her index finger toward the bottom of the frame; static camera.
</details>

## Recording order

1. **Voice:** record all 12 lines (Marta: curious, expressive; Elena: calm, confident), one file per shot.
2. **References:** generate the Marta and Elena character sheets and the two locations; approve them before moving on.
3. **Keyframes:** make all 12 keyframes and check the continuity (phone in her right hand, mug in her left, gaze direction).
4. **Video:** Seedance image-to-video with 2–3 takes per shot, choosing on hands, eyes and lips.
5. **Delivery to editing:** one mp4 per shot, named `S01.mp4` … `S12.mp4`, with no text or music. Remotion does the rest.

- [ ] Voices approved
- [ ] Marta and Elena references approved
- [ ] 12 keyframes approved
- [ ] 12 clips generated and chosen
