# Motion design — how the EVA video ads look and move

Canvas **1080×1920, 30 fps** (9:16 Reels/Stories). Brand values come from the `eva-brand` skill; `theme.ts` mirrors them.

## Layout rules
- **Logo top-left in every scene, same size (70px).** Only the end card may centre other content. This is a brand rule from the business, and it is enforced in the `Logo` component itself.
- Page padding 80px. Nothing touches the edges.
- Headlines 96–132px bold, line-height ~1.02, letter-spacing −0.035em, max 2–3 lines, one phrase highlighted in green (`greenLight` on dark).
- Sub text 34–46px. Card titles 38–42px. Small print 28px.
- **Fill the frame.** Type that looks big in the editor reads small on a phone; large text with tight spacing beats a lot of white space.
- Text never sits on faces; photo scenes carry a dark gradient under the text area.

## The component kit (`ui.tsx`)
| Component | Use |
|---|---|
| `Reveal` | Headline lines rising from behind a mask — the default for headlines |
| `Rise` | Simple fade + rise for secondary text |
| `Pop` | Spring scale-in for cards, chips, buttons |
| `Backdrop` | Brand background (light / navy / green) with the leaf watermark |
| `Logo` | Always top-left, fixed size |
| `Phone` | iPhone-like frame: 720×1440, radius 88, pill notch 196×56 |
| `Card`, `Check`, `Cta`, `Arrow`, `Pill` | UI blocks; `Arrow` is SVG, never the "→" glyph inside a circle |
| `PhotoZoom` | Slow Ken Burns for photo scenes |

## Scene grammar that works
1. **Hook (~9s)** — the problem, health first. Photo beats of 1.6–2s, each with one word and one supporting graphic (fever reading, failed call), centred on one axis, ending on the question.
2. **Promise** — "Basta con una frase", phone chat with app chrome.
3. **Proof** — the AI searching, comparing, booking: progress bar, doctor cards, a pick, a confirmation line.
4. **Confirmation** — push notification on a lock screen.
5. **Control** — change or cancel the appointment (the user is never trapped).
6. **Breadth** — specialty cards landing on their words + drifting chips + an honest inclusion claim.
7. **Warmth** — one human photo line ("Para ti y para los tuyos").
8. **End card** — logo, slogan on two balanced lines, CTA pill with an SVG arrow, store badges.

## Transitions
A 0.6s brand-green wipe on scene changes, no sound. Keep photo scenes on a slow zoom (1.04 → 1.12) so stills never feel dead.

## Phone mock-ups
Use the `Phone` component and fill the screen: a header ("Eva · asistente" with a green dot), chat bubbles, an input bar. An empty white phone screen reads as unfinished, and a small phone leaves an awkward gap under the headline — raise it with a negative bottom margin so it bleeds off the frame.

## Honest claims
Only promise what the product does. On the specialties scene, the inclusion claim covers just the specialties shown, with a line pointing to the app for the rest. Health copy must never tell the viewer they have a condition (Meta's personal-attributes policy — see the `eva-salud-ads` skill's ad-design best practices).
