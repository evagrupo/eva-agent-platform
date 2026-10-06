# Eva Salud — brand & design system

Source: `brand/manual/` — the brand manual extracted for reading: `README.md` (page-by-page summary), `raw-text.md` (exact wording) and `images/page-NN.jpg` (every page as an image) + approved ad series (Sept 2026).

## Identity
- Grupo EVA, founded 2021, "innovadora y disruptiva". Mission: *democratizar* basic services (telefonía, energía, salud) with the best service and competitive prices.
- Values to express: **sencillez**, **sin letras pequeñas ni ataduras**, confianza, calidez, empoderamiento. Brand line: "Muerde la manzana".
- Logo = **hoja** (leaf symbol, always present) + **eva** (name, always present) + **salud** (sector descriptor, right side).
- Photography (manual): *"Las fotos reflejarán confianza, calidez y empoderamiento."*

## Logo files (`brand/logos/`)
| File | Use |
|---|---|
| `logo.svg` | Positive: navy wordmark + green leaf — on white/light backgrounds, or inside a white chip on photos |
| `logo-blanco.svg` | All white — on dark photos, navy or green backgrounds |
| `logo-negativo.svg` | White wordmark + green leaf — on navy |
| `hoja.svg` / `hoja-blanca.svg` | Leaf alone, correct bounding box (never crop it; decorative use at 7–12% opacity) |
| `otras-marcas-*.svg` | EVA Seguros / Protect / Móvil — only if the ad is for those brands |

Don't recolor the logo in other colors, stretch it, add effects or place the positive logo on busy photos without a white chip. Minimum ad height ~56px on a 1080px canvas.

## Colors
| Token | Hex | Role |
|---|---|---|
| `--green` | `#00983a` | Color principal (Pantone 355 C) — CTAs, highlights, brand backgrounds |
| `--green-dark` | `#006B29` | Color principal (Pantone 349 C) — text on mint, CTA text on white, gradients |
| `--navy` | `#232263` | Color secundario (Pantone 273 C) — headlines, dark bands, gradients |
| `--purple` | `#ab49cc` | Color secundario (Pantone 2582 C) — accent for estética/beauty topics only |
| `--mint` | `#e6f4eb` | Light green tint — pills, soft backgrounds |
| `--lilac` | `#f4e8f9` | Light purple tint — estética panels |
| light green on dark | `#5fd08a` / `#9fe3b8` | Headline `<em>` highlight on navy/green |

Manual tints: 85 / 70 / 50 / 25 % of each color are allowed.

## Typography
- **Noto Sans** only (`brand/fonts/`). Titulares: Noto Sans **Bold**. Subtítulos y cuerpo: Noto Sans **Regular**.
- Ads (1080 wide): headline 72–104px bold, line-height ~1.02, letter-spacing −0.035em, max 2–3 lines, one phrase in color via `<em>`. Sub 34–42px regular. CTA 30–34px bold in a pill with "→". Pills: 24px bold uppercase, letter-spacing .14em.

## Voice & copy (Castilian Spanish, tú)
- Short, warm, direct. One idea per ad. Spain vocabulary: móvil, ordenador, cita, consulta, peques, salón.
- Headline patterns that worked: "Tu médico, en casa." · "¿Fiebre a las 3 de la mañana?" · "Pedir cita nunca fue tan fácil." · "Tu salud, sin letra pequeña." · "Al dentista, sin miedo."
- CTAs: Descarga la app · Pide tu cita · Pedir cita · Reservar · Consultar · Probar ahora · Empezar.

## Product claims
Verified in the app copy (safe): consultas médicas **incluidas en tu suscripción**; **Pedir cita con IA**; encontrar y reservar cita médica; especialistas; cita dental; videoconsulta.
Used in ads but **not verified** — confirm with the team before publishing paid media: pediatría, fisioterapia, dermatología, salud mental/psicología online, medicina estética, specific times ("jueves 10:00", "ahora"), prices.
If the app repo is available, re-check `apps-frontend/packages/i18n/locales/eva-salud/es.json`.
Never invent prices, discounts, waiting times or coverage.
