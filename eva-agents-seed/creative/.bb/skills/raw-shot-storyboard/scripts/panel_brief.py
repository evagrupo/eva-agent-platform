#!/usr/bin/env python3
"""Write the stick-figure panel brief for an image-generating agent (e.g. a Codex child).

Usage: panel_brief.py <project_dir>    (needs shots.json and cast.json)
Output: <project_dir>/PANEL-BRIEF.md
"""
import json, os, sys

proj = os.path.abspath(sys.argv[1])
shots = json.load(open(os.path.join(proj, "shots.json")))
cast = json.load(open(os.path.join(proj, "cast.json")))
fmt = cast.get("format", "9:16")
size = {"9:16": "1024×1792 (or the tallest portrait size)", "16:9": "1792×1024", "1:1": "1024×1024",
        "4:5": "1024×1280"}.get(fmt, "matching the format")

chars = "\n".join(
    f"- **{n}** ({', '.join(s['id'] for s in shots if s.get('who') == n)}): {c['look']}. "
    f"{c.get('props','')}. Always looks toward **{c.get('looks_toward','the other character')}**"
    f"{' — never at the camera unless the shot says so' if c.get('looks_toward') else ''}."
    for n, c in cast.get("characters", {}).items())
places = "\n".join(f"- **{n}**: {d}" for n, d in cast.get("locations", {}).items())
lines = "\n".join(
    f"- **{s['id']}** · {s.get('who','')} · {s.get('place','')} · {s.get('frame','')} · "
    f"looks: {s.get('dir','')} · {s.get('action','')}"
    for s in shots)

brief = f"""# Brief: stick-figure frames for raw AI-video shots

Draw **{len(shots)} simple storyboard frames**, one per shot below. They plan what a video model
must generate as **raw footage**, so draw **only the camera's view of the real scene at the
moment described**.

## Output
`panels/<id>.png` for every id below (exact ids), **{fmt}** ({size}).

## Style — deliberately simple
- Stick figures / very simple figure sketches, black marker on white paper. Round head with a
  simple face (eyes, eyebrows, mouth) so the emotion reads; simple body shapes.
- Only what the shot needs: the character, the key props, a few lines of background.
- Pure black and white, at most a few hatch lines.
- Respect the framing size: medium close-up = chest up · medium = waist up · close-up = shoulders and face.

## Never in the drawings
- No text boxes, pills, badges, speech bubbles, arrows, counters, icons, logos or UI — that is the edit layer, not the footage.
- **No letters or numbers anywhere.**
- No camera-move arrows (camera moves are typeset in the caption).
- No readable phone or laptop screen.

## Continuity (identical across frames)
{chars}

Locations:
{places}

## Shots
{lines}

## Finish
Check each frame: right character, facing direction, props in the right hands, framing size,
and **no text, arrows, bubbles, icons or numbers**. Redraw failures. Report the files written.
"""
open(os.path.join(proj, "PANEL-BRIEF.md"), "w").write(brief)
print(os.path.join(proj, "PANEL-BRIEF.md"))
