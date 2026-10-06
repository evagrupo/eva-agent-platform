# QA checklist

## Every generated photo (open at full size, one by one — never trust the generator's own claim)
- [ ] No screen content visible to the viewer; devices face their users (we see the back of phones/tablets/laptop lids).
- [ ] Count hands per person = 2; five natural fingers each; grips make physical sense; no hands that belong to nobody.
- [ ] Eyes symmetric, teeth normal, skin real (no wax), hair natural.
- [ ] Objects are physically sound: no holes, melted edges, floating items, warped furniture, impossible reflections.
- [ ] No text, gibberish letters, logos, or watermarks.
- [ ] Gaze and roles consistent (who looks at what; gloves/uniforms on the right people).
- [ ] Market fit (Spain), brief fit, negative space where requested.
- [ ] When a file is "replaced", confirm it actually changed (size/hash differs) and re-inspect it.

Failures → a fixes note per image: file, exact error, why it's wrong, the corrected composition, "keep everything else". Regenerate (or edit with the image as reference) and re-check until it passes.

## Every rendered ad (read the contact sheets in `png/_check/`, and open single PNGs when in doubt)
- [ ] Text never covers faces or heads; no text over text.
- [ ] Logo readable (chip on busy/bright areas), leaf fully visible (never cropped).
- [ ] CTA is content-width, not stretched; nothing touches canvas edges (≥64px margin).
- [ ] Headline ≤3 lines, sensible line breaks, accents rendered (Noto Sans loaded).
- [ ] Photos loaded (no blank areas) and sharp at 2160×2700.
- [ ] Copy is Castilian Spanish and only makes verified claims (or the claim is flagged to the user).

When the user reports one mistake, search every photo and ad for the same class of mistake and fix all of them.
