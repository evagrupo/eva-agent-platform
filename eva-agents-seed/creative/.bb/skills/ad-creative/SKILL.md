---
name: ad-creative
description: Create and iterate marketing image ad creatives with the native Codex/OpenAI image-generation tool. Use when the user asks for Meta/Facebook/Instagram ad images, Google Display or responsive-display image assets, paid-social graphics, static ad concepts, product hero ads, UGC-style stills, campaign visuals, or multiple visual ad variations. This skill is image-generation only and must fail closed when Codex/OpenAI or the native image_gen tool is unavailable.
---

# Ad Creative — Image Studio

Create polished, campaign-ready image concepts for paid advertising. The default deliverable is visual output, not a written description of an image.

## Mandatory execution gate

Before doing creative work or generating a prompt:

1. Verify that the current thread is running on Codex/OpenAI.
2. Verify that the native Codex image-generation tool (`image_gen`) is visible and callable.
3. If either check fails, stop. Tell the user that this skill requires Codex/OpenAI with native image generation enabled, and ask them to reopen the task in that environment.

Do not substitute another model, third-party image app, stock-image search, web image, CLI/API fallback, code-generated placeholder, or text-only mockup. A skill cannot switch the active provider or summon a missing tool.

Use the native image-generation tool for every requested asset and every variation. For a multi-asset request, make one native tool call per distinct asset or variation. Do not silently fall back when a call fails.

## Scope and boundaries

- This skill creates raster image creatives for advertising and marketing.
- Do not publish, launch, upload, or manage campaigns. Generate and hand off assets only.
- Do not invent medical, financial, legal, performance, testimonial, statistical, or guaranteed-result claims.
- Use only copy and claims supplied by the user, approved brand materials, or clearly labeled neutral copy. If exact copy is missing, prefer a text-free composition with negative space or ask a blocking question.
- Never fabricate reviews, customer quotes, product UI, certifications, logos, or before/after outcomes.
- For an exact logo, product package, app screen, or person, use the supplied asset/reference when available. Do not ask the image model to redraw a precise logo or hallucinated UI.
- Preserve existing assets non-destructively. Never overwrite a user file unless replacement was explicitly requested.

## Intake

Read available product or brand context before asking questions, including `.agents/product-marketing.md`, brand guides, logos, product screenshots, and approved copy if they exist.

Ask only questions that block a good result. Collect, when available:

- Product, offer, and landing-page action
- Target audience and awareness stage
- Campaign objective and desired emotional angle
- Platform and placement
- Approved headline, CTA, disclaimer, and claims
- Brand colors, typography, logo, photography style, and reference assets
- Number of concepts, number of variations, language, and destination folder

If a detail is not blocking, make a short assumption and label it in the handoff. Never invent a claim to fill a brief.

## Creative planning

For each concept, define a distinct angle before writing prompts. Useful lanes include:

- Problem or friction: show the moment the product removes a real obstacle.
- Product benefit: make the product and its approved benefit immediately legible.
- Contrast or transformation: show a grounded before/after state without promising an unsupported outcome.
- Social proof or creator style: use only real, supplied proof; otherwise make it clearly illustrative and not a testimonial.
- Identity or aspiration: express the audience's desired identity without implying a sensitive personal attribute.

Keep brand constants fixed across variants and vary one major creative axis at a time: hook, composition, setting, lighting, visual metaphor, or art direction. Avoid producing near-duplicates with only a color change.

Default production quantity:

- One concept requested: generate 3 visual variations.
- A broad campaign request: propose up to 3 concepts with 3 variations each unless the user specifies another quantity.
- Do not silently generate a very large batch. Ask before exceeding 9 images or before creating many platform crops.

## Platform and format planning

Generate separate compositions for each important placement; do not stretch one crop into every format.

| Placement | Default aspect ratio | Creative guidance |
| --- | --- | --- |
| Meta/Facebook/Instagram feed | 1:1 and 4:5 | Keep the product and short hook inside a centered safe area. |
| Instagram Stories/Reels and Meta vertical placements | 9:16 | Keep critical content away from the top and bottom interface zones. |
| Meta landscape/link placement | 1.91:1 | Use a wide focal composition with generous side-safe space. |
| Google Display landscape | 1.91:1 | Prefer a clear product-led image and minimal baked-in text. |
| Google Display square | 1:1 | Keep the focal point and brand cue centered for responsive crops. |
| Fixed display banners | Use the dimensions in the brief or current platform spec | Treat common sizes such as 300x250, 336x280, 728x90, and 300x600 as separate layouts, not automatic resizes. |

If exact platform compliance matters and the brief does not provide current dimensions, ask the user to confirm the placement/spec. Aspect ratio in a prompt does not guarantee a final pixel size.

For Google responsive display assets and text-heavy ads, generate a clean image with little or no baked-in copy and provide approved headlines/descriptions separately. For any in-image copy, use short, literal text only.

## Prompt construction

Shape each native image-generation prompt into this compact production spec:

```text
Use case: ads-marketing
Asset type: <platform and placement>
Objective: <what the ad should make the viewer understand or do>
Audience: <audience and awareness stage>
Creative angle: <one clear hook or visual idea>
Primary request: <the image to create>
Product/brand: <provided product and brand cues>
Scene/backdrop: <environment and context>
Subject: <main subject and action>
Style/medium: <commercial photography, editorial, 3D, collage, illustration, etc.>
Composition/framing: <aspect ratio, focal point, negative space, crop-safe placement>
Lighting/mood: <lighting and emotional tone>
Color/materials: <approved palette and surface details>
Text (verbatim): "<exact approved in-image text>" or "none"
Constraints: <invariants, logo/product requirements, safe areas>
Avoid: <unapproved claims, watermarks, fake UI, extra logos, artifacts>
```

If the user's brief is already specific, normalize it without adding unrelated characters, objects, slogans, colors, or narrative beats. If it is vague, add only tasteful details that materially improve the ad concept.

## Native generation workflow

1. Choose `generate` or `edit`. Treat supplied images as references unless the user explicitly asks to change them.
2. For a local edit target, inspect it with the built-in image viewer before sending it to the native image tool. Preserve stated invariants aggressively.
3. Generate the first concept and its requested variations with the native tool. Use one call per asset/variation and keep prompts distinct.
4. Inspect every returned image before retrying. Check the product, people, composition, crop safety, text, logo treatment, artifacts, and claim compliance.
5. If an iteration is needed, make one targeted change and re-check. Never blindly retry; verify the prior result first to avoid duplicate outputs.
6. If the native tool remains unavailable or errors, report the blocker. Do not switch providers or silently create a substitute.

## Quality checklist

Before handoff, confirm:

- The creative communicates one idea within a fast glance.
- The product is recognizable and visually dominant enough for the placement.
- The composition survives the requested crop and keeps critical elements in safe areas.
- In-image copy, if any, is short and verbatim; no invented text or illegible fake typography is presented as final.
- Colors, style, logo usage, and product details follow supplied brand inputs.
- There are no watermarks, accidental extra products, malformed hands/faces, fake interface elements, or unrelated brand marks.
- Claims are approved, grounded, and free of guarantees or prohibited medical/results language.
- Variations test meaningful creative differences rather than cosmetic duplicates.

## Handoff format

Return the generated images inline by default, grouped by concept and placement. Keep the written handoff brief:

```text
Concept: <name and angle>
Platform/placement: <placement and aspect ratio>
Variant: <what changed>
In-image copy: <exact text or none>
Assumptions: <only if needed>
Review: <any crop, text, or compliance note>
```

If the user asks for workspace files, move or copy the selected native outputs into a clear, versioned folder such as `outputs/ad-creative/<campaign>/<platform>/`. Report every saved path. Keep discarded variants out of the final folder unless requested, and never publish the assets.

## Near-miss routing

- Route copy-only requests to the broader ad-copy workflow; do not invoke this image workflow unless an image is requested.
- Route video-only requests to a video-production skill; this skill may supply still-image concepts only when the user asks for them.
- Route logos, icons, SVGs, deterministic UI, or exact product screenshots to the appropriate native design/code workflow unless the user asks for raster concept exploration.
