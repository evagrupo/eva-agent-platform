---
name: eva-salud-ads
description: Create on-brand static ads for Eva Salud (Grupo EVA health app) — Meta/Instagram/Facebook feed 4:5, square or stories — with the Eva brand kit bundled (logos, leaf symbol, Noto Sans, green/navy palette, Castilian voice, verified product claims), an approved library of photorealistic stock photos, AI photo generation with strict QA, and a swipeable carousel with max-quality PNG/ZIP downloads. Use whenever someone asks for Eva Salud / EVA ads, anuncios, creatividades, banners, posts, campaign visuals, more ad variations or new photos for Eva — even without saying "Meta". Works in Codex, Claude Code, bb or any agent that reads skills.
---

# Eva Salud static ads

Everything Eva-specific is already in this skill. Don't ask for the brand kit.

- `brand/`: logos (including the leaf with a correct bounding box), Noto Sans fonts, `manual/` (the brand manual as markdown + page images, no PDF to parse), and `fotos/` (approved 1080px photos).
- `references/brand.md`: colors, type scale, logo usage, Castilian voice, and **which product claims are verified**. Read it first.
- `references/photo-brief.md`: realism rules and the proven scene library for new photos.
- `references/qa-checklist.md`: photo and ad checks. Every output goes through them.
- `references/ad-design-best-practices.md`: formats and safe zones, the 1-second hierarchy test, copy, photos, layout and contrast, logo, CTA, **carousel ads**, series and testing, Meta health-ad policy (personal attributes), and an export pre-flight checklist. Read it when planning concepts, and again before the final render.
- `template/carousel.html`: the carousel plus 8 example ads, one per layout.
- `scripts/`: `init_project.sh`, `generate_image.py`, `web_images.sh`, `render_ads.sh`, `serve.sh`, `extract_isotype.sh`.

`$SKILL` below means this skill's directory.

The team cares about three things: photos that look **genuinely real** with zero AI mistakes, simple on-brand layouts, and correct Castilian copy. Anything they have to point out themselves is a failure. Check before you show.

## Agent-specific notes: Codex vs Claude Code vs bb

This skill runs in any agent that reads `SKILL.md`. The workflow is the same everywhere; what differs is **how you make images, look at images, and share the result**. Work out which environment you're in first.

| | **Codex** (CLI / app) | **Claude Code** (or other agents without image generation) | **bb** (any provider) |
|---|---|---|---|
| Install path | `~/.codex/skills/<skill>/` | `~/.claude/skills/<skill>/` | `~/.bb/skills/<skill>/` (synced from the skills repo) |
| Generate photos | **Built-in image generation tool**, directly. No API key needed. Use the largest portrait size, make variations and keep the best. | **Can't generate images.** Ask the user for an OpenAI API key and run `scripts/generate_image.py` (model `gpt-image-2.5`). | If this thread can't generate images, delegate to a Codex child (`bb thread spawn --provider codex --model gpt-5.6-luna --reasoning-level max …`). Otherwise use route 3. |
| Fix a bad photo | Regenerate or edit with your image tool, passing the bad image as reference plus the exact correction | `generate_image.py --edit <img> --prompt "Keep everything. Fix: …"` | `bb thread tell <child> --mode auto "Read FIXES-N.md …"` |
| Look at photos and renders (QA) | Open each file with the image viewing tool (e.g. `view_image`) at full size | `Read` tool on the PNG/JPG (it shows images); crop with PIL to zoom into details | Same as the underlying provider |
| Secrets | Not needed for images | Key via env var `OPENAI_API_KEY` or `<project>/.env`. Never echo it, commit it, or put it in shared ZIPs | Use the `secrets` skill so the key never appears in chat |
| Share the carousel | `scripts/serve.sh` → give `http://localhost:8765/` (user opens locally) or the folder path | Same as Codex | `scripts/serve.sh` also runs `bb connect expose` → give the public URL as a markdown link |
| Sandbox gotchas | Workspace-write sandboxes may block `/tmp` or network: keep the project inside the workspace, and ask for approval if headless Chrome or `http.server` is blocked | Headless Chrome needed for renders; if it's a snap Chromium it can't read `/tmp` or hidden dirs (scripts already screenshot into `~/meta-ads-tmp`) | Parent permission mode caps the child's |

Rules that apply everywhere:
- **Never skip the full-size visual review because a tool or child says "done/fixed".** Verify the file changed and look at it.
- **Codex: don't spend an API key or install an OpenAI SDK.** Your built-in tool is better and free of setup.
- **Claude Code: don't pretend to have generated images, or fall back to random stock URLs.** Either get the key and use the script, or reuse the approved photo library (Eva) and say what's missing.
- **In any agent without a browser/Chrome,** say so and deliver the HTML folder plus instructions (`python3 -m http.server`, then open it). Rendering PNGs needs Chrome/Chromium.

## 1. Set up

```bash
$SKILL/scripts/init_project.sh /tmp/eva-ads-<topic>   # or a folder the user prefers
```

This copies fonts, logos, the photo library (`site/img/web/*.jpg`), the template (`site/index.html`) and a `BRIEF.md` skeleton.

Plan the ads with the user's goal in mind:
- Pick 6–12 concepts.
- Each has one idea, a headline (≤3 lines, one `<em>` highlight), a short sub and a CTA.
- Use only claims marked verified in `brand.md`. Anything unverified gets listed for the user at the end.
- Apply `references/ad-design-best-practices.md`: one idea per ad, headline ≤8 words, the squint test, and no copy that says the viewer has a condition ("¿Sufres…?", "tu peca que te preocupa"). If the user asks for a **carousel ad** (multi-card), design card 1 as a standalone hook, keep one visual thread across cards, and close on a CTA card.

## 2. Photos

**Reuse first.** The library photos in `brand/fotos/` are approved. Use them when the topic fits.

**New photos.** Fill `BRIEF.md` from `references/photo-brief.md` (the global style block goes in verbatim). Save originals as `site/img/ai/<name>.png`. Pick the image-generation route this agent supports:

1. **Built-in image generation** (Codex and similar): generate each image with your own tool at the largest portrait size. Make several variations and keep the best.
2. **bb, but no image tool here:** you may delegate to a Codex child that has one, then wait for its report without polling:
   `bb thread spawn --parent-self --project "$BB_PROJECT_ID" --provider codex --model gpt-5.6-luna --reasoning-level max --permission-mode full --environment <project_dir> --prompt "Read <project_dir>/BRIEF.md and generate every image into site/img/ai/ …"`
   Send later fixes with `bb thread tell <id> --mode auto "…"`.
3. **No image generation at all** (e.g. Claude Code outside bb): use the OpenAI Images API with **gpt-image-2.5**. You need an API key:
   - If `OPENAI_API_KEY` isn't set, ask the user for one.
   - In bb, use the `secrets` skill so the value never enters the chat. Elsewhere, have them set the env var or put `OPENAI_API_KEY=…` in `<project_dir>/.env`, and keep that file out of anything shared.
   - Never echo or log the key.
   ```bash
   python3 $SKILL/scripts/generate_image.py --prompt-file prompts/<name>.txt --out site/img/ai/<name>.png --n 3
   python3 $SKILL/scripts/generate_image.py --edit site/img/ai/<name>.png --prompt "Keep everything. Fix: …" --out site/img/ai/<name>.png
   ```
   For each prompt, combine the global style block with that image's description.

**Review every photo yourself** at full size using `references/qa-checklist.md`, whichever route made it. The worst past errors:
- a phone or laptop screen shown to the viewer while the person looks at it
- mangled fingers around devices
- a gloved hand that belonged to nobody
- a table with a hole in it
- a "fixed" file that was actually unchanged

Loop fixes until every photo passes. Then run `$SKILL/scripts/web_images.sh site/img/ai site/img/web`.

## 3. Build the ads

Edit `site/index.html`:
- Keep the viewer, CSS and script.
- Replace the example slides with your ads, and set the header title and `PNG_PREFIX` (e.g. `'eva-<campaign>'`).
- Each ad is `<section class="slide" data-name="…"><div class="frame"><div class="ad LAYOUT">…</div></div></section>`.
- Photos go in `<div class="photo" style="background-image:url(img/web/<name>.jpg);background-position:…">`. For HQ export the page swaps in `img/ai/<name>.png` automatically when it exists.

| Layout | When |
|---|---|
| `P` white panel bottom | Safest; any photo |
| `N` navy band bottom + faint leaf | Any photo; strong, clinical topics |
| `B g` / `B n` bottom gradient (green/navy), white text | Faces in the top two-thirds |
| `T light` / `T dark` text on top | Only with real empty space in the top ~35% |
| `L` text left over white gradient | Subject on the right |
| `V` brand green, typography only | Manifesto or offer ads, no photo |

Extras: `.chat` bubbles (Cita con IA), `.card` confirmation, `.pill` topic label, `.cta` (`.white`, `.navy`), `.logo.chip` on busy photos. Use purple only for estética.

Rules learned the hard way:
- **Text never sits on faces.** If it does, change the layout instead of zooming the photo.
- **The leaf is always whole.**
- **CTAs are content-width.**
- **Logos stay readable.** Use a white chip or a stronger gradient.
- **Replaced logo or symbol files get a new `?v=N`** on their `src`. Always serve with `scripts/serve.sh` (no-cache), or browsers keep showing the old, cropped file.

## 4. Render at max quality, check, share

```bash
$SKILL/scripts/serve.sh <project_dir>/site 8765
$SKILL/scripts/render_ads.sh http://localhost:8765/index.html <count> <project_dir>/site/png <PNG_PREFIX>
```

- **Renders:** each ad at **2160×2700** (2× device scale, lossless PNG, original AI photos), plus `<prefix>-todos.zip`. The carousel's "Descargar PNG" and "Todos (.zip)" links point to these files. Use scale 3 (5th argument) if the user wants even larger files.
- **Review:** read every contact sheet in `png/_check/` against the QA checklist and the pre-flight list at the end of `ad-design-best-practices.md`, fix, and re-render. Zoom into small details (symbol edges, accents) with a crop from the 2× PNG when in doubt.
- **Share:** in bb, `serve.sh` prints the public `bb connect` URL; give it as a markdown link. Elsewhere, give the local URL or the folder path. The carousel is also fine opened via a local server on the user's machine.
- **Series:** when adding a new series, keep the previous page (e.g. `v1.html`) and link it from the header.

## 5. Report back (short, in the user's language)

- the carousel link
- the list of ads (headline each)
- what photo QA caught and fixed
- unverified claims to confirm
- where the files live (suggest a permanent folder if they're in `/tmp`)
