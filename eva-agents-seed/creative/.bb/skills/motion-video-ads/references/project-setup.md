# Project setup — Remotion + a live browser preview

## Why this shape
Two entry points over the same components:
- **`src/main.tsx`** — a Vite app with `@remotion/player`, for the live preview BB can show (`bb remotion-player`). Has the asset preloader and the click-to-play button.
- **`src/remotion/index.ts` → `Root.tsx`** — `registerRoot` for the CLI (`remotion still`, `remotion render`).

Copy `template/` into a new folder and `npm install`. Versions that work together: `remotion` + `@remotion/player` + `@remotion/cli` `4.0.399`, React 19.2, Vite 7.1.

```
project/
├── index.html            @font-face for Noto Sans, dark page background
├── vite.config.ts        server.host true, port 3000
├── src/main.tsx          preloader + Player + "▶ Reproducir con sonido"
├── src/remotion/
│   ├── index.ts          registerRoot
│   ├── Root.tsx          one <Composition> per cut (current + frozen versions)
│   ├── Ad.tsx            SCENES / VO / SFX tables + single <Audio> mix
│   ├── theme.ts          brand tokens
│   ├── ui.tsx            Reveal, Pop, Rise, Backdrop, Logo, Phone, Card, Cta, Arrow…
│   ├── assets.ts         every file to preload
│   └── scenes/*.tsx      one file per scene
├── public/img|audio      photos, logos, fonts, sfx, mix.mp3
└── timeline.json         input for scripts/mix_audio.py
```

## Preloading (`main.tsx`)
Decode every image, await `document.fonts.ready`, buffer `mix.mp3`, show a progress bar, and time-box each file at ~8s so one slow asset can't block the preview. Without this, images pop in mid-scene.

## Playback
Never `autoPlay`: browsers block sound and the Player logs an error. Ship a button that seeks to 0, sets volume 1 and plays.

## Assets
- Photos: use the client's approved library when one exists; otherwise generate them (see SKILL.md) and review every one yourself before it goes in the cut.
- Logos/fonts/colours: from the client's brand kit — real SVG logos and the licensed font files, never a screenshot or a lookalike font.
- Keep source photos as PNG in `public/img/` and let Remotion scale them; there is no separate web/hi-res split in video.

## Live preview
```bash
npm run dev                  # http://localhost:3000, hot-reloads on every edit
```
In bb, `bb remotion-player open /path/to/project --composition Ad` runs the same dev server and gives the user a shareable URL plus a **Video preview** panel tab.
