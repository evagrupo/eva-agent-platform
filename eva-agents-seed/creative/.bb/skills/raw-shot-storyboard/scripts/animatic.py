#!/usr/bin/env python3
"""Build the sketch video (animatic) of an approved storyboard with its recorded voices.

  animatic.py <project> [--out out] [--gap 0.3] [--title "..."] [--subtitle "..."] [--lang es]

Needs: <project>/shots.json, <project>/panels/<id>.png, <project>/<out>/raw/<id>.mp3 (from voices.py).
Steps: trim each line's dead air -> match loudness across voices (loudnorm -16 LUFS) -> place lines on a
turn-taking timeline (no overlap, --gap seconds between turns) -> mix -> typeset subtitle frames ->
mux an mp4. Silent shots hold for their planned `dur`.

Output in <project>/<out>/: animatic.mp4 (subtitled), animatic-clean.mp4 (raw shots only, no overlays), call.mp3, timeline.json, lines/<id>.mp3, index.html
(the listening page: video + script table that seeks the video + per-line audio + needed clip lengths).
"""
import argparse, html, json, os, re, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

PALETTE = [(179, 84, 30), (0, 152, 58), (47, 95, 179), (138, 63, 166), (179, 134, 42), (42, 138, 138)]
HEX = lambda c: "#%02x%02x%02x" % c

def planned(s):
    m = re.search(r"([\d.,]+)", str(s.get("dur", "")))
    return float(m[1].replace(",", ".")) if m else 3.0

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project"); ap.add_argument("--out", default="out")
    ap.add_argument("--gap", type=float, default=0.3); ap.add_argument("--tail", type=float, default=0.7)
    ap.add_argument("--title", default="Animatic"); ap.add_argument("--subtitle", default="")
    ap.add_argument("--lang", default="es", choices=["es", "en"])
    a = ap.parse_args()
    proj = os.path.abspath(a.project); out = os.path.join(proj, a.out); raw = os.path.join(out, "raw")
    shots = json.load(open(os.path.join(proj, "shots.json")))
    FF = L.ffmpeg()
    T = {"es": ("Guion con audio por línea", "Duración que debe tener cada clip", "Planificado", "Voz", "Clip necesario", "Inicio",
                "Diálogo", "Quién", "Con subtítulos", "Solo las tomas"),
         "en": ("Script with per-line audio", "Clip length each shot needs", "Planned", "Voice", "Clip needed", "Start",
                "Dialogue", "Who", "With subtitles", "Raw shots only")}[a.lang]
    for d in ("norm", "lines", "frames", "frames_clean"): os.makedirs(os.path.join(out, d), exist_ok=True)

    colors, order = {}, []
    for s in shots:
        if s["who"] not in colors: colors[s["who"]] = PALETTE[len(colors) % len(PALETTE)]

    # 1. trim + loudness-match every spoken line
    length = {}
    for s in shots:
        sid = s["id"]
        if not s.get("line"):
            length[sid] = planned(s); continue
        src = os.path.join(raw, f"{sid}.mp3")
        if not os.path.exists(src): raise SystemExit(f"missing {src} — run voices.py first")
        st, en = L.speech_window(src)
        wav = os.path.join(out, "norm", f"{sid}.wav")
        subprocess.run(FF + ["-i", src, "-af", f"atrim=start={st:.3f}:end={en:.3f},asetpts=PTS-STARTPTS,"
                             "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100", "-ac", "1", wav], check=True)
        subprocess.run(FF + ["-i", wav, "-c:a", "libmp3lame", "-b:a", "160k", os.path.join(out, "lines", f"{sid}.mp3")], check=True)
        length[sid] = L.duration(wav)

    # 2. turn-taking timeline
    t, tl = 0.15, {}
    for s in shots:
        tl[s["id"]] = {"start": round(t, 3), "len": round(length[s["id"]], 3), "talk": bool(s.get("line"))}
        t += length[s["id"]] + (a.gap if s.get("line") else 0.2)
    total = t + a.tail
    ids = [s["id"] for s in shots]
    for i, sid in enumerate(ids):
        tl[sid]["frame_from"] = 0.0 if i == 0 else tl[sid]["start"] - a.gap / 2
        tl[sid]["frame_to"] = total if i == len(ids) - 1 else tl[ids[i + 1]]["start"] - a.gap / 2

    # 3. mix
    spoken = [s["id"] for s in shots if s.get("line")]
    ins, filt, lab = [], [], []
    for i, sid in enumerate(spoken):
        ins += ["-i", os.path.join(out, "norm", f"{sid}.wav")]
        ms = int(tl[sid]["start"] * 1000)
        filt.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]"); lab.append(f"[a{i}]")
    filt.append("".join(lab) + f"amix=inputs={len(lab)}:duration=longest:normalize=0,volume=0.95,atrim=0:{total:.2f}[o]")
    call = os.path.join(out, "call.mp3")
    subprocess.run(FF + ins + ["-filter_complex", ";".join(filt), "-map", "[o]", "-c:a", "libmp3lame", "-b:a", "192k", call], check=True)

    # 4. frames
    W, H = 1080, 1920
    fb = ImageFont.truetype(os.path.join(L.SKILL, "assets/fonts/NotoSans-Bold.ttf"), 56)
    fr = ImageFont.truetype(os.path.join(L.SKILL, "assets/fonts/NotoSans-Regular.ttf"), 34)
    def wrap(d, s, font, maxw):
        o, ln = [], ""
        for w in s.split():
            c = (ln + " " + w).strip()
            if d.textlength(c, font=font) <= maxw: ln = c
            else: o.append(ln); ln = w
        return o + [ln]
    for s in shots:
        sid, who = s["id"], s["who"]
        p = os.path.join(proj, "panels", f"{sid}.png")
        im = (Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS) if os.path.exists(p) else Image.new("RGB", (W, H), "white"))
        im.save(os.path.join(out, "frames_clean", f"{sid}.png"))      # raw shot: no subtitle, chips or progress bar
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
        if s.get("line"):
            lines = wrap(d, L.strip_tags(s["line"]), fb, W - 200)
            bh = 70 + len(lines) * 72 + 36; y0 = 1700 - bh
            d.rounded_rectangle((50, y0, W - 50, 1700), 34, fill=(20, 20, 50, 214))
            d.rounded_rectangle((80, y0 - 28, 80 + 40 + d.textlength(who, font=fr) + 30, y0 + 30), 26, fill=colors[who] + (255,))
            d.text((100, y0 - 21), who, font=fr, fill=(255, 255, 255, 255))
            for j, ln in enumerate(lines): d.text((90, y0 + 58 + j * 72), ln, font=fb, fill=(255, 255, 255, 255))
        label = f"{sid} · {who}" + (f" · {s['place']}" if s.get("place") else "")
        wlab = d.textlength(label, font=fr)
        d.rounded_rectangle((40, 40, 40 + wlab + 44, 112), 20, fill=(255, 255, 255, 235)); d.text((62, 52), label, font=fr, fill=(35, 34, 99, 255))
        clip = f"clip ~{tl[sid]['len'] + 1.0:.1f} s" if s.get("line") else f"clip {planned(s):.0f} s"
        cw = d.textlength(clip, font=fr)
        d.rounded_rectangle((W - 80 - cw, 40, W - 40, 112), 20, fill=(255, 255, 255, 235)); d.text((W - 62 - cw, 52), clip, font=fr, fill=(35, 34, 99, 255))
        d.rectangle((0, H - 18, int(W * tl[sid]["frame_from"] / total), H), fill=(0, 152, 58, 255))
        Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB").save(os.path.join(out, "frames", f"{sid}.png"))

    # 5. mp4: subtitled version and a clean version (the raw shots only, same audio and timing)
    def mux(frames_dir, name):
        vin, vlab = [], ""
        for i, sid in enumerate(ids):
            vin += ["-loop", "1", "-framerate", "30", "-t", f"{tl[sid]['frame_to'] - tl[sid]['frame_from']:.3f}",
                    "-i", os.path.join(out, frames_dir, f"{sid}.png")]
            vlab += f"[{i}:v]"
        subprocess.run(FF + vin + ["-i", call, "-filter_complex", f"{vlab}concat=n={len(ids)}:v=1:a=0[v]", "-map", "[v]", "-map", f"{len(ids)}:a",
                                   "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-shortest",
                                   "-movflags", "+faststart",          # index at the start so browsers play before the download ends
                                   os.path.join(out, name)], check=True)
    mux("frames", "animatic.mp4")
    mux("frames_clean", "animatic-clean.mp4")

    # 6. listening page + timeline
    rows, clips = "", ""
    for s in shots:
        sid, who = s["id"], s["who"]; x = tl[sid]; cls = "c%d" % list(colors).index(who)
        if s.get("line"):
            rows += (f'<tr data-t="{max(x["frame_from"], 0):.2f}"><td class="id">{sid}</td><td><span class="chip {cls}">{html.escape(who)}</span></td>'
                     f'<td class="tx">{html.escape(L.strip_tags(s["line"]))}</td><td class="num">{int(x["start"] // 60)}:{x["start"] % 60:04.1f}</td>'
                     f'<td><audio controls preload="none" src="lines/{sid}.mp3"></audio></td></tr>')
            need, pl = x["len"] + 1.0, planned(s)
            clips += (f'<tr class="{"over" if need > pl + 0.4 else ""}"><td class="id">{sid}</td><td>{html.escape(who)}</td><td class="num">{pl:g} s</td>'
                      f'<td class="num">{x["len"]:.1f} s</td><td class="num"><b>~{need:.1f} s</b></td></tr>')
    css = "".join(f".chip.c{i}{{background:{HEX(c)}}}" for i, c in enumerate(colors.values()))
    open(os.path.join(out, "index.html"), "w").write(f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(a.title)}</title>
<style>*{{box-sizing:border-box}}body{{font-family:system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 20px;color:#232263}}h1{{letter-spacing:-.02em;margin-bottom:4px}}.sub{{color:#6b6b95;margin-bottom:22px}}
h2{{margin:34px 0 12px;font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#006b29}}.top{{display:grid;grid-template-columns:340px 1fr;gap:32px;align-items:start}}video{{width:100%;border-radius:18px;background:#000}}
table{{width:100%;border-collapse:collapse}}td,th{{padding:10px;border-bottom:1px solid #e3e3ec;text-align:left;vertical-align:middle}}th{{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#6b6b95}}
tr[data-t]{{cursor:pointer}}tr[data-t]:hover,tr.on{{background:#f1f8f4}}.id{{font-weight:700;width:56px}}.num{{font-variant-numeric:tabular-nums;white-space:nowrap}}.tx{{font-size:16px}}
.chip{{font-size:12px;font-weight:700;padding:4px 10px;border-radius:99px;color:#fff}}{css}audio{{width:210px;height:34px}}tr.over td{{background:#fff6ec}}.tg{{display:flex;gap:8px;margin-top:10px}}.tg button{{flex:1;padding:9px;border:1px solid #cfd0e3;border-radius:99px;background:#fff;font-weight:700;color:#232263;cursor:pointer}}.tg button.on{{background:#00983a;border-color:#00983a;color:#fff}}.warn{{background:#fff6ec;border:1px solid #f0c89a;border-radius:14px;padding:14px 18px;font-size:14px;margin-top:16px}}</style>
<h1>{html.escape(a.title)}</h1><div class="sub">{html.escape(a.subtitle)} · {total:.0f} s</div>
<div class="top"><div><video id="v" controls playsinline src="animatic.mp4"></video><div class="tg"><button id="b1" class="on">{T[8]}</button><button id="b2">{T[9]}</button></div></div><div><audio controls preload="none" src="call.mp3" style="width:100%"></audio></div></div>
<h2>{T[0]}</h2><table><tr><th></th><th>{T[7]}</th><th>{T[6]}</th><th>{T[5]}</th><th></th></tr>{rows}</table>
<h2>{T[1]}</h2><table><tr><th></th><th>{T[7]}</th><th>{T[2]}</th><th>{T[3]}</th><th>{T[4]}</th></tr>{clips}</table>
<div class="warn">{T[4]} = {T[3].lower()} + ~0.5 s / ~0.5 s.</div>
<script>const v=document.getElementById('v'),B=['b1','b2'].map(i=>document.getElementById(i)),F=['animatic.mp4','animatic-clean.mp4'];B.forEach((b,i)=>b.onclick=()=>{{const t=v.currentTime,p=!v.paused;v.src=F[i];B.forEach((x,j)=>x.classList.toggle('on',j===i));v.onloadedmetadata=()=>{{v.currentTime=t;if(p)v.play()}}}});const R=[...document.querySelectorAll('tr[data-t]')];R.forEach(r=>r.onclick=e=>{{if(e.target.tagName==='AUDIO')return;v.currentTime=+r.dataset.t;v.play()}});
v.ontimeupdate=()=>{{let c=null;R.forEach(r=>{{if(v.currentTime>=+r.dataset.t-.01)c=r}});R.forEach(r=>r.classList.toggle('on',r===c))}}</script>""")
    json.dump({"total": round(total, 2), "timeline": tl}, open(os.path.join(out, "timeline.json"), "w"), indent=1)
    print(f"{out}/animatic.mp4  total {total:.1f}s")
    for s in shots:
        if s.get("line"):
            x = tl[s["id"]]; print(f"  {s['id']} {s['who']:8} voice {x['len']:4.1f}s  planned {planned(s):g}s  needs ~{x['len'] + 1:.1f}s")

if __name__ == "__main__":
    main()
