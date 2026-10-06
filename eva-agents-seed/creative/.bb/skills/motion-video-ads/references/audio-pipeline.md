# Audio pipeline — voice, music, effects

Needs `ELEVENLABS_API_KEY`. Ask the user for it if it is not in the environment; never print it.

## Voice
- **Voice:** use the brand's own cloned voice when it has one. Otherwise pick a **native speaker of the target locale** from the shared library (`GET /v1/shared-voices?language=xx&gender=…`) — an English voice reading Spanish sounds wrong immediately. Note the chosen id in the project so later versions match.
- **Model:** **`eleven_v4`** — ElevenLabs' newest and most emotive model, for produced content. `eleven_v4_turbo` has the same expressive range but is built for real-time voice agents (~100 ms) — don't use it for ads. `eleven_v3` is the previous generation, and `eleven_multilingual_v2` sounds flat and generic by comparison. v4 also keeps the speaker identity stable when you regenerate a line (v3 drifted), and follows tags more reliably.
- **Audio tags (v4)** are free-text direction in square brackets, placed **before the clause they direct**. They change delivery and are not spoken. Rules from ElevenLabs' v4 guidance:
  - **One emotion per sentence segment.** Contrasting emotions in one segment give a worse result. Add a new tag only where the tone actually turns: `[curious] ¿No te encaja? [trusting] Cambia la cita o cancélala.`
  - **Qualifiers go inside the same bracket, comma-separated:** `[anxious, hushed]`, `[proud, warm]`, `[frustrated, disbelief]`. Don't stack separate brackets for one segment.
  - **Be explicit about voice quality** (`[low, gravelly]`, `[hushed]`, `[softly]`) rather than ambiguous cues that could be read as a sound effect.
  - **A tag carries across the line**, so one at the start is usually enough.
  - **If a line does not land, swap the tag before rewriting the words.** Try `[worried]` for `[sad]`, `[hushed]` for `[whispers]`.
  - Palette that suits ads — *low energy:* tired, bored, distant, let down · *tense:* anxious, stressed, confused, vulnerable · *calm:* peaceful, content, curious, thoughtful, trusting · *high energy:* excited, playful, proud, optimistic, amazed · *heated:* critical, bitter, mad · *delivery:* whispers, softly, quietly, hushed, disbelief · *pacing:* slowly, rushed, pause, snappy, drawn out · *reactions:* laughs, sighs, gasps.
- **Pacing is punctuation, not SSML.** v4 (like v3) does **not** support `<break>` tags. Ellipses slow a line and create real breaths ("Fiebre… a las tres de la mañana."), dashes cut a speaker off, exclamation marks add intensity. The `speed` setting accepts 0.7–1.2 (default 1.0).
- **Context:** v4 works best on passages, not isolated sentences. Because we need one file per scene for timing, `tts.py` sends each line with `previous_text` and `next_text` (tags stripped) so the delivery stays continuous across lines. Keep `lines.json` in script order.
- **Pronunciation:** v4 reads IPA between slashes (`/ˈeva/`) for names that come out wrong.
- **Settings:** `stability 0.5, similarity_boost 0.8, use_speaker_boost true`, plus `language_code: "es"`. Lower stability (~0.35) is more varied; raise it if a line wanders.
- **Always verify** that tags were not read aloud: `scripts/tts.py` transcribes every file back with `scribe_v1`, flags any tag word that appears in the transcript, and prints what was actually said. (The STT call must use curl — urllib gets 403 from the WAF.)
- **Timing moves when you change model.** v4 lines ran ~0% to +25% longer than v3 on the EVA script (+2.6 s over ten lines), a few shorter. Use `tts.py --compare <old_dir>` to see the per-line change, then re-time the whole film and re-run the mixer.

One file per line, named by scene (`hook1`, `pitch`, `proof`, `confirm`, `control`, `breadth`, `human`, `end`).

## Music
`POST /v1/music` with `music_length_ms`. Prompt that worked:
> Warm uplifting minimal corporate advertising bed for a health app. Soft marimba and gentle plucks, airy pads, light clicky percussion, hopeful and modern, 105 bpm, clean mix with plenty of space for a voiceover, calm start, gentle build at N seconds, resolves on a warm final chord. No vocals, no lyrics.

Always generate ~1s longer than the final cut.

## Sound effects
`POST /v1/sound-generation`. Six are enough: `pop, tap, type, ping, success, ring` (bundled in `template/public/audio/sfx/`). Use them only on real interactions. **No transition whooshes.**

## The mix (this is the important part)
Never put many `<Audio>` tags in the composition — the Player stalls (troubleshooting #1). Write a timeline JSON and run:

```bash
python3 scripts/mix_audio.py timeline.json    # → public/audio/mix.mp3
```

It: ducks the music to 0.17 under every voice line and back to 0.36 between them; fades in 0.8s and out 2.2s; trims the silence baked into each effect; mixes with `amix … normalize=0` then `volume=0.9`; warns if the bed is shorter than the video.

The composition then plays exactly one file:
```tsx
<Audio src={staticFile("audio/mix.mp3")} />
```
Keep the VO/SFX tables in `Ad.tsx` as documentation, mirrored in the timeline JSON, and re-run the mixer after any change.

Remotion's bundled ffmpeg has a trimmed filter set — no `afade`, no `alimiter` — which is why fades and ducking are one `volume` expression.
