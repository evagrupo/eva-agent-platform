# Best practices: static ads and carousel ads (Meta: Facebook / Instagram)

Read this before planning concepts and again before the final render. Each rule comes with the reason behind it. When a rule conflicts with the brand manual, follow the brand manual and mention the trade-off.

## Contents
1. Formats and safe zones
2. The 1-second test (hierarchy)
3. Copy
4. Photos and people
5. Layout, type and color
6. Logo and brand
7. CTA
8. Carousel ads (multi-card)
9. Series and testing variants
10. Policy and legal (health especially)
11. Export and pre-flight checklist

---

## 1. Formats and safe zones

| Placement | Canvas | Ratio | Notes |
|---|---|---|---|
| Feed (FB/IG) — default | 1080×1350 | 4:5 | Takes the most vertical space in feed, so it's the best default |
| Feed square / carousel cards | 1080×1080 | 1:1 | Carousel cards should all use one ratio (1:1 or 4:5) |
| Stories / Reels | 1080×1920 | 9:16 | Keep text, logo and CTA out of the top ~14% (≈270px) and bottom ~20% (≈380px), where the profile bar, reply field and CTA sticker sit. Leave ~65px free on each side |
| Right column / feed crop | — | 1:1 crop of 4:5 | Keep the key message in the center square when you can |

- Export at 2× (e.g. 2160×2700) as lossless PNG. Meta recompresses uploads, so starting sharp keeps text crisp. Stay under ~30 MB per file.
- Keep ≥64px margins (on 1080px) around all text, logos and buttons. Edges get cropped or rounded in some placements.
- If the same concept runs in both feed and stories, build a separate 9:16 layout. A 4:5 ad centered on a 9:16 canvas looks lazy.

## 2. The 1-second test (hierarchy)

Feed users scroll past in about a second. Each ad has to get its point across at thumb size.

- **One idea per ad:** one message, one image, one action. If you need "and", make it two ads.
- **Reading order:** (1) the photo's emotion or subject → (2) headline → (3) CTA → (4) logo/sub. Size and contrast should enforce that order.
- **Squint test:** view the render at ~25–30% scale (a phone at arm's length). If the headline isn't instantly readable, make it bigger or shorter. If the eye doesn't know where to go, remove something.
- **Negative space is a feature.** Crowded ads look like ads and get skipped; calm ones look premium.

## 3. Copy

- **Headline:** ≤6–8 words, ≤3 lines, big and bold. Speak to a real moment or benefit ("¿Fiebre a las 3 de la mañana?"), not the feature list.
- **One highlighted phrase** (brand color `<em>`) carries the payoff. Don't highlight more than one.
- **Sub:** one short line that makes the headline concrete (what / how). Skip it if the headline is enough.
- **Keep text on the image minimal.** Meta no longer rejects text-heavy images, but ads with less text (roughly under 20% of the area) still tend to deliver more cheaply. Put details in the post's primary text, not the image.
- Write in the audience's language and variant (e.g. Castilian: móvil, ordenador), using the brand's form of address (tú/usted), with no typos and correct accents (check that the font renders them).
- **Be specific, not generic.** "Pedir cita con IA" beats "La mejor app de salud".
- Numbers, prices, times and guarantees only when verified. Unverified claims are risky legally and for ad review.

## 4. Photos and people

- **Real people in real moments** outperform generic stock and illustrations for services. Show the result or emotion of using the product (relief, calm, joy), not an abstract concept.
- **Faces** attract attention. Eye contact with the camera works for trust (doctor portrait); a gaze toward the device or the other person works for storytelling. Headlines placed along a person's gaze get read.
- **The audience should see themselves:** age, family situation, setting and ethnicity should match the target market. Vary them across a series.
- **Physically correct:** devices face their users (the camera never sees screen content), hands are correct (5 fingers, 2 per person), no ownerless limbs, objects are intact, no gibberish text. One AI mistake destroys trust in a health or finance brand.
- **Composition:** subject on a third, with clean negative space where the text goes. Faces and hands never sit under text or gradients.
- **Consistent grading** across a series (warm natural light, similar contrast) so the ads read as one brand.

## 5. Layout, type and color

- Use a small set of proven layouts (bottom panel, bottom band, bottom gradient, text-top over clean space, text-left, type-only) and rotate them across a series for variety within a system.
- **Contrast:** text vs background at least 4.5:1 (large headlines 3:1 minimum). Over photos, always use a panel, band or gradient behind text; never place text on raw busy image areas.
- **Type:** at most 2 weights (bold headline, regular sub). Headline line-height ~1.0–1.1 with slightly tight tracking. Sub ≥34px on a 1080 canvas; nothing smaller than ~22px except legal lines.
- **Line breaks:** break headlines by meaning (`<br>` by hand), and avoid one-word orphans or widows.
- **Color:** brand primary for CTA and highlights, brand dark for text and bands, one accent at most per ad. Keep background photos from fighting the brand color (avoid big red/orange areas next to a green CTA).
- **Grid:** the same margins, logo position and CTA position within a series. Consistency makes a campaign recognizable after a few impressions.
- **Decorative brand symbols:** always whole (never clipped by a container), low opacity (7–12%), never behind small text.

## 6. Logo and brand

- The logo should be visible in every ad, but small (roughly 5–8% of the canvas height), in a corner (top-left or bottom-left). People should know who it is without the logo shouting.
- Use the correct logo version for the background (positive / white / negative), or a white chip on busy photos. Never recolor, stretch or add effects.
- Keep brand fonts and exact hex colors, and don't approximate. Make sure fonts actually load in the render (check accents and bold weight).
- **Cache busting:** when you replace a logo or symbol file, change its URL version (`?v=N`) and serve with `Cache-Control: no-store` (`scripts/serve.sh`). Otherwise the browser keeps showing the old, broken file.

## 7. CTA

- One CTA per ad, verb-first, 1–3 words: Descarga la app · Pide tu cita · Reservar · Probar ahora.
- A pill button in the brand primary (or white on dark), content-width, bottom-left or bottom-right, never stretched.
- The on-image CTA should match the Meta CTA button you'll choose (e.g. "Descargar", "Reservar") so the promise is consistent.
- Don't put fake UI (fake play buttons, fake close icons, fake notifications that imitate the OS) in ads. That's against Meta policy. Branded in-app cards and chat bubbles are fine when they clearly depict the product.

## 8. Carousel ads (multi-card)

A Meta carousel ad is 2–10 cards shown one after another.
- **Card 1 is the hook.** It has to work alone, since most people only see card 1. Strongest image and boldest headline go here.
- **Visual thread:** the same grid, colors, type and logo position on every card. Designs that continue across card edges (a shape or line crossing into the next card) invite swiping.
- **One idea per card:** a benefit, a use case, a step (1 → 2 → 3), or a person or story.
- **Last card closes:** a clear CTA plus the brand ("Descarga Eva Salud"), optionally a summary of the benefits.
- **Same ratio on all cards** (1:1 or 4:5). 3–5 cards is usually the sweet spot.
- Each card can have its own headline and link in Ads Manager, so write per-card headlines that complement (not repeat) the image text.
- Enable or consider "show best performing cards first" only when cards are independent. Turn it off for step-by-step stories.

## 9. Series and testing variants

- Deliver a **series**, not a single ad: 6–12 concepts across different angles (pain point, benefit, audience segment, feature, price/value, social proof when verified).
- Make testable variants that change **one variable** (hook headline, photo or layout) so the results teach something.
- Name files and slides clearly (`<brand>-<campaign>-<concept>-<n>`), and keep a list of which claim each ad makes.
- Refresh creatives regularly. Audiences get tired of the same image after a few weeks at high frequency.

## 10. Policy and legal (health especially)

- **Personal attributes (Meta):** don't assert or imply that the viewer has a health condition, or other personal attributes, by addressing them directly.
  - ✗ "¿Sufres ansiedad?", "¿Tu peca te preocupa?", "Tu diabetes…".
  - ✓ Frame it generally or about the service: "Salud mental online con profesionales", "Revisión de lunares con dermatología", "Cuando alguien en casa tiene fiebre".
  - Review every headline with "tú/tu" plus a condition, and rewrite before publishing.
- **Health and beauty:** no before/after images, no body shaming, no unrealistic outcome promises, no "cure" claims. Aesthetic treatments may need extra care.
- **Health advertising in Spain** (publicidad sanitaria) can require authorization depending on the service and region, and claims must be truthful and verifiable. Flag it to the user when ads promote medical services.
- No misleading claims, fake urgency or prices that aren't real. Only use verified product claims and list unverified ones for the user.
- **Images:** no real people's likeness without rights, no trademarked logos in photos, and nothing that could be read as a real clinic's branding.

## 11. Export and pre-flight checklist

- [ ] Correct canvas per placement; safe zones respected (stories).
- [ ] Rendered at 2× lossless PNG; photos are the originals (not recompressed copies); fonts loaded; no blank photo areas.
- [ ] Squint test passed at 25–30% scale.
- [ ] Headline ≤8 words and ≤3 lines, one highlight, correct accents, meaningful line breaks.
- [ ] Text contrast OK; no text on faces or hands.
- [ ] Logo correct version, readable, not oversized; brand symbols whole; asset URLs cache-busted after changes.
- [ ] One CTA, content-width, verb-first, matching the Meta CTA button.
- [ ] Photos pass the realism QA (devices, hands, objects, gaze, no text).
- [ ] Copy passes the personal-attributes check; claims verified or flagged.
- [ ] Series consistent (grid, logo spot, grading); carousel card 1 works alone and the last card has the CTA.

---

## Eva Salud specifics
- **Default placement:** 4:5 feed (1080×1350, exported at 2160×2700). Build a separate 9:16 layout for stories.
- **Logo:** top-left (`logo.svg` in a white chip over photos, `logo-blanco.svg` on dark gradients). Keep the leaf symbol whole, at 7% opacity in navy bands and 12% on green type-only ads.
- **Series grammar used so far:** pill (topic) → headline with one green highlight → one-line sub → green pill CTA with "→". Purple is only for estética.
- **Past copy that needed care (personal attributes):** "Esa peca que te preocupa, revisada" addressed the viewer's condition and was rewritten to "Lunares y pecas, en buenas manos." Service-framed copy like "Hablar ayuda" is fine.
- **Carousel ad idea for Eva:** card 1 hook ("Tu médico, en casa.") → cards 2–4 services (videoconsulta, especialistas, dental) → card 5 "Pide cita con IA" chat → last card "Consultas médicas incluidas en tu suscripción" + Descarga la app.
