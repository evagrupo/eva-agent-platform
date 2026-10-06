#!/usr/bin/env python3
"""Render a raw-shot storyboard sheet: stick-figure frames + typeset captions.

Captions are typeset here, never drawn by the image model (models garble text).
Each card shows: shot id, clip length, character · location chip, the spoken
line, framing · camera, action, gaze · emotion. Nothing from the edit layer.

Usage:
  compose_sheet.py <project_dir> [--title "..."] [--subtitle "..."] [--rule "..."]...
    <project_dir> must contain shots.json and panels/<id>.png
Output: <project_dir>/storyboard.html and <project_dir>/storyboard.png
"""
import argparse, html, json, os, shutil, subprocess, time

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
e = html.escape
PALETTE = ["#b3541e", "#00983a", "#2f5fb3", "#8a3fa6", "#b3862a", "#2a8a8a"]

CSS = """
@font-face{font-family:"Noto Sans";src:url(fonts/NotoSans-Regular.ttf);font-weight:400}
@font-face{font-family:"Noto Sans";src:url(fonts/NotoSans-Bold.ttf);font-weight:700}
@font-face{font-family:"Noto Sans";src:url(fonts/NotoSans-Italic.ttf);font-style:italic}
*{box-sizing:border-box;margin:0;padding:0}
body{width:%(W)dpx;background:#fbfaf7;font-family:"Noto Sans",sans-serif;color:#1f1f3a;padding:48px 56px 40px}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:40px;border-bottom:3px solid #1f1f3a;padding-bottom:16px;margin-bottom:26px}
h1{font-size:42px;letter-spacing:-.02em}
.sub{font-size:18px;color:#555;margin-top:6px;max-width:1500px}
.rules{font-size:16px;color:#333;text-align:right;line-height:1.6}
.grid{display:grid;grid-template-columns:repeat(%(COLS)d,1fr);gap:28px 22px}
.frame{position:relative;aspect-ratio:%(AR)s;border:2.5px solid #1f1f3a;border-radius:4px;overflow:hidden;background:#fff}
.frame img{width:100%%;height:100%%;object-fit:cover;display:block}
.frame .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#bbb}
.id{position:absolute;top:8px;left:8px;background:#1f1f3a;color:#fff;font-weight:700;font-size:15px;padding:3px 9px;border-radius:4px}
.dur{position:absolute;top:8px;right:8px;background:#fff;border:1.5px solid #1f1f3a;font-weight:700;font-size:14px;padding:3px 8px;border-radius:4px}
.who{position:absolute;bottom:8px;left:8px;font-weight:700;font-size:14px;padding:3px 9px;border-radius:4px;color:#fff}
.cap{margin-top:10px;font-size:14px;line-height:1.36}
.l{display:block;font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;margin-top:6px}
.line{font-style:italic;font-size:15px;color:#1f1f3a}
.foot{margin-top:30px;padding-top:12px;border-top:1.5px solid #ddd;font-size:14px;color:#666}
"""

LABELS = {  # caption labels; switch with --lang
    "es": ("Diálogo", "Plano · cámara", "Acción", "Mirada · emoción", "pendiente", "sin diálogo", "voz en off, sin lip-sync"),
    "en": ("Dialogue", "Framing · camera", "Action", "Gaze · emotion", "pending", "no dialogue", "voice-over, no lip-sync"),
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--title", default="Storyboard — raw shots for AI video")
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--rule", action="append", default=[], help="continuity rule shown top-right (repeatable)")
    ap.add_argument("--footer", default="")
    ap.add_argument("--lang", default="es", choices=list(LABELS))
    ap.add_argument("--aspect", default="9/16", help="frame aspect, e.g. 9/16, 16/9, 1/1, 4/5")
    a = ap.parse_args()

    proj = os.path.abspath(a.project)
    shots = json.load(open(os.path.join(proj, "shots.json")))
    L = LABELS[a.lang]
    colors, chip = {}, lambda w: colors.setdefault(w, PALETTE[len(colors) % len(PALETTE)])

    n = len(shots)
    vertical = a.aspect in ("9/16", "4/5", "3/4")
    cols = (6 if n > 8 else 4 if n > 4 else n) if vertical else (3 if n > 4 else 2)
    W = 2600 if vertical else 3000

    cards = []
    for s in shots:
        img = f"panels/{s['id']}.png"
        inner = f'<img src="{img}">' if os.path.exists(os.path.join(proj, img)) else f'<div class="empty">{L[4]}</div>'
        line = f'«{e(s["line"])}»' if s.get("line") else f"<i>({L[5]})</i>"
        if s.get("line") and s.get("vo") == "off":
            line += f' <b style="font-style:normal;color:#b3541e">· {L[6]}</b>'
        place = f" · {e(s['place'])}" if s.get("place") else ""
        cards.append(f"""<div><div class="frame">{inner}<span class="id">{e(s['id'])}</span>
<span class="dur">{e(s.get('dur',''))}</span><span class="who" style="background:{chip(s.get('who','—'))}">{e(s.get('who','—'))}{place}</span></div>
<div class="cap"><span class="l">{L[0]}</span><div class="line">{line}</div>
<span class="l">{L[1]}</span>{e(s.get('frame',''))} · {e(s.get('cam',''))}
<span class="l">{L[2]}</span>{e(s.get('action',''))}
<span class="l">{L[3]}</span>{e(s.get('dir',''))} · {e(s.get('emotion',''))}</div></div>""")

    rules = "<br>".join(e(r) for r in a.rule)
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS % {'W': W, 'COLS': cols, 'AR': a.aspect}}</style></head><body>
<div class="head"><div><h1>{e(a.title)}</h1><div class="sub">{e(a.subtitle)}</div></div><div class="rules">{rules}</div></div>
<div class="grid">{''.join(cards)}</div>
{'<div class="foot">'+e(a.footer)+'</div>' if a.footer else ''}</body></html>"""

    # fonts next to the page; snap Chromium cannot read hidden dirs like ~/.bb
    shutil.copytree(os.path.join(SKILL, "assets", "fonts"), os.path.join(proj, "fonts"), dirs_exist_ok=True)
    open(os.path.join(proj, "storyboard.html"), "w").write(doc)

    chrome = next((b for b in ("chromium", "google-chrome", "chromium-browser")
                   if subprocess.run(["which", b], capture_output=True).returncode == 0), None)
    if not chrome:
        raise SystemExit("No Chrome/Chromium: open storyboard.html in a browser instead")
    port = 8797
    srv = subprocess.Popen(["python3", "-m", "http.server", str(port)], cwd=proj,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(0.8)
        tmp = os.path.expanduser("~/meta-ads-tmp/storyboard-render.png")
        os.makedirs(os.path.dirname(tmp), exist_ok=True)
        subprocess.run([chrome, "--headless=new", "--no-sandbox", "--hide-scrollbars",
                        f"--window-size={W},4400", "--force-device-scale-factor=1.25",
                        "--virtual-time-budget=6000", f"--screenshot={tmp}",
                        f"http://localhost:{port}/storyboard.html"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=150)
        from PIL import Image, ImageChops
        im = Image.open(tmp).convert("RGB")
        box = ImageChops.difference(im, Image.new("RGB", im.size, (251, 250, 247))).getbbox()
        if box:
            im = im.crop((0, 0, im.width, min(im.height, box[3] + 50)))
        out = os.path.join(proj, "storyboard.png")
        im.save(out, optimize=True)
        print(out, im.size)
    finally:
        srv.terminate()

if __name__ == "__main__":
    main()
