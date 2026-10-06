#!/usr/bin/env python3
"""Build the generation sheet (Markdown) from shots.json + cast.json:
global settings, cast/locations, the shot table, and a keyframe prompt + motion prompt
per shot for image-to-video models (Seedance, Kling, Veo, Runway…).

Prompts are drafted from the fields; a shot may override them with "keyframe"/"motion".
Usage: generation_sheet.py <project_dir> [--title "..."] [--storyboard storyboard.png]
Output: <project_dir>/generation-sheet.md
"""
import argparse, json, os

ap = argparse.ArgumentParser()
ap.add_argument("project"); ap.add_argument("--title", default="Generation sheet — raw shots")
ap.add_argument("--storyboard", default="storyboard.png")
a = ap.parse_args()
proj = os.path.abspath(a.project)
shots = json.load(open(os.path.join(proj, "shots.json")))
cast = json.load(open(os.path.join(proj, "cast.json")))
C, P, fmt = cast.get("characters", {}), cast.get("locations", {}), cast.get("format", "9:16")

def keyframe(s):
    if s.get("keyframe"): return s["keyframe"]
    c, loc = C.get(s.get("who"), {}), P.get(s.get("place"), s.get("place", ""))
    return (f"{fmt} photo, {s.get('frame','')} of {s.get('who')} ({c.get('look','')}), {c.get('props','')}, "
            f"in {loc}. {s.get('action','').split('.')[0]}. Looks toward {c.get('looks_toward', s.get('dir',''))}. "
            f"Expression: {s.get('emotion','')}. Realistic skin texture, 35mm, natural light, no text.")

def motion(s):
    if s.get("motion"): return s["motion"]
    if s.get("vo") == "off":
        talk = ". Mouth closed or natural, she does not speak — the line is a voice-over added in the edit"
    else:
        talk = " while speaking the line (lip-sync to the provided audio)" if s.get("line") else ""
    return (f"{s.get('action','')}{talk}. Camera: {s.get('cam','static')}. Gaze: {s.get('dir','')}. "
            f"Natural blinking, realistic hands with five fingers, no text on screen.")

total = sum(float(str(s.get("dur", "0")).split()[0].replace(",", ".") or 0) for s in shots)
out = [f"""---
title: {a.title}
status: draft
tags: [storyboard, raw-footage, image-to-video]
---

# {a.title}

> [!NOTE] Scope
> Raw footage only: people, place, framing, action and lip-synced dialogue. Subtitles, badges, UI, logos, prices, sound and the end card are added in the edit — keep every generated frame free of text.

**Storyboard:** [{a.storyboard}]({a.storyboard})

## Global settings

| | |
|---|---|
| Format | {fmt}, highest resolution available, 24 fps |
| Clips | {len(shots)} clips · ~{total:.0f} s of material |
| Method | Image first: one keyframe per shot from the character references → image-to-video |
| Dialogue | Record the lines first (WAV). Lip-sync from audio is **unverified** on Seedance 2.5 (audio_urls is documented only as a reference): run one test shot first |
| Handles | ~0.5 s in pose before the line and ~0.5 s after it |
| Headroom | Face in the upper-middle; keep the top ~15% and bottom ~25% free of the face (overlays go there) |
| Screens | When the edit will put UI on a phone/laptop, generate the screen as flat **chroma green (#00FF00)**, evenly lit, for screen replacement; otherwise keep screens turned away |
| Never | Text, logos or subtitles in frame · readable screens · looking into the lens unless the shot says so |

## Cast and locations

| | Description (paste into every prompt) |
|---|---|"""]
for n, c in C.items():
    out.append(f"| **{n}** | {c['look']}. {c.get('props','')}. Looks toward {c.get('looks_toward','—')}. |")
for n, d in P.items():
    out.append(f"| **{n}** | {d} |")
out.append("\n## Shots\n\n| # | Who | Framing / camera | Action | Line | Clip |\n|---|---|---|---|---|---|")
for s in shots:
    line = f"*{s['line']}*" if s.get("line") else "—"
    if s.get("line") and s.get("vo") == "off":
        line += " *(voice-over, no lip-sync)*"
    out.append(f"| {s['id']} | {s.get('who','')} | {s.get('frame','')} · {s.get('cam','')} | {s.get('action','')} | {line} | {s.get('dur','')} |")
out.append("\n## Prompts per shot\n")
for s in shots:
    out.append(f"<details>\n<summary>{s['id']} · {s.get('who','')} · {s.get('emotion','')}</summary>\n\n"
               f"**Keyframe:** {keyframe(s)}\n\n**Motion:** {motion(s)}\n</details>\n")
out.append("""## Production order

- [ ] Lines recorded and approved (one voice per character)
- [ ] Character references and locations approved
- [ ] Keyframes approved (continuity: props, hands, gaze)
- [ ] 2–3 video takes per shot, best chosen on hands, eyes and lips
- [ ] Delivered as one clean mp4 per shot, named by shot id
""")
path = os.path.join(proj, "generation-sheet.md")
open(path, "w").write("\n".join(out))
print(path)
