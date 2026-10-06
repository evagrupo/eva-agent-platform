# Voices and expressions (Eleven v4)

Model: **`eleven_v4`** (not `eleven_v4_turbo`, which is for real-time agents). v4 keeps a speaker's identity stable across regenerations and follows tags more reliably than v3. Cloned voices (instant or professional) work.

## Eleven v4 rules (ElevenLabs guidance)
- Tags are free-text direction in square brackets, **before the clause they direct**. They are not spoken.
- **One emotion per sentence segment.** Contrasting emotions in one segment degrade the result.
- **Qualifiers go inside the same bracket, comma-separated:** `[curious, disbelief]`, `[trusting, warm]`, `[confident, snappy]`.
- Describe voice quality explicitly (`[hushed]`, `[softly]`, `[low, gravelly]`) rather than vague cues.
- A tag carries across the line; add a new one only where the tone turns: `[curious] ¿No te encaja? [trusting] Cambia la cita.`
- If a line does not land, **swap the tag** before rewriting the words.
- Pacing is punctuation, not SSML: ellipses slow and breathe, dashes cut off, exclamation marks add intensity. v4 has **no `<break>` tags**. `speed` accepts 0.7–1.2.
- v4 reads IPA between slashes for names that come out wrong.

## Tag palette for conversations
| Moment | Tags |
|---|---|
| Surprised / sceptical customer | `curious, disbelief` |
| Curious question | `curious` |
| Sarcastic, tired of the hassle | `sarcastic` |
| Unsure | `uncertain, curious` |
| Relieved | `relieved, happy` |
| Confident advisor | `confident`, `warm, confident`, `confident, snappy` (lists) |
| Reassuring | `trusting, warm` |
| Friendly pitch | `optimistic, friendly` |
| Playful call to action | `playful, confident` |
| Whispered / intimate | `whispers`, `hushed` |

`voices.py` maps the Spanish `emotion` field automatically (`TAGMAP` in `_lib.py`: sorprendida→surprised, escéptica→disbelief, cálida→warm, hastiada→sarcastic, dudosa→uncertain, aliviada→relieved, cómplice→playful…). Anything unmapped is passed through as free text. Write `tags` explicitly when the mapping is not exactly what you want.

## Choosing voices
1. `find_voices.py` lists the shared library by accent, gender, age and use case, sorted by popularity.
2. Cast by role, not by popularity: the customer is casual and curious, the advisor calm and professional. Make them **audibly different** (age, pace, register) so listeners know who is speaking without seeing them.
3. Audition 2–3 per character on **their actual first line** (`voices.py --samples`). A demo sentence hides how a voice handles surprise or a list.
4. The agent cannot hear: present the options and let the user choose. Say which is the primary and which are alternates, and why.
5. Record voices and ids in `voices.json` so later versions match.

## Quality gates in `voices.py`
- Speech-to-text of every take; the diff counts dropped, added or changed words (spelled-out numbers are ignored — `34,40` is read aloud as words).
- A tag word heard in the transcript counts as a failure.
- Up to 4 retakes with other seeds; the best take is kept and logged in `takes.json`.
- Some voices read a decimal comma aloud ("treinta y cuatro **coma** cuarenta"). Put the natural wording in `say` and leave the subtitle alone.
- Network blips and 429/5xx are retried automatically.

## What to tell the user afterwards
- The total call length against the planned length, and the clip length each shot needs (line + ~0.5 s each side).
- Any line flagged `<-- CHECK`.
- Claims the lines make that the product audit does not support (for EVA: "sin carencias", "sin límite de edad", absolute "ninguna letra pequeña", and specialty counts that conflict between sources).
