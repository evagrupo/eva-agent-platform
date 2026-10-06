#!/usr/bin/env python3
"""Record the dialogue of a storyboard with ElevenLabs Eleven v4 — one voice per character,
fitting expression tags per shot, QA'd against speech-to-text, with automatic retakes.

Prerequisite: the storyboard is APPROVED (shots.json is final). Re-recording is cheap but
every wording change moves every later timing.

  voices.py <project> --voices voices.json [--out out] [--reuse DIR:Char,Char] [--only S01,S02]
  voices.py <project> --samples candidates.json          # audition voices on each character's first line

shots.json fields used: id, who, line, say (optional: how to pronounce it, e.g. "treinta y cuatro con cuarenta" for "34,40"), emotion (Spanish direction, mapped to v4 tags) or tags
(explicit, e.g. "curious, disbelief"). Shots without a line are silent.
voices.json: {"Marta": {"id": "<voice_id>", "name": "Jenni"}, "Elena": {"id": "...", "name": "..."}}
candidates.json: {"Marta": [{"id": "...", "name": "..."}, ...], "Elena": [...]}

Output: <out>/raw/<id>.mp3 and <out>/takes.json (the chosen take per line, its transcript and diff).
Rules applied (Eleven v4 guidance): tags before the clause they direct, ONE emotion per segment with
qualifiers comma-separated in one bracket, ellipses for breaths, neighbour lines as previous_text /
next_text in script order across speakers, and a retake with another seed when the transcript
drops/doubles a word or reads a tag aloud.
"""
import argparse, json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--voices"); ap.add_argument("--samples")
    ap.add_argument("--out", default="out"); ap.add_argument("--model", default="eleven_v4")
    ap.add_argument("--stability", type=float, default=0.45); ap.add_argument("--similarity", type=float, default=0.8)
    ap.add_argument("--speed", type=float, default=1.0); ap.add_argument("--lang", default="es")
    ap.add_argument("--retries", type=int, default=4)
    ap.add_argument("--reuse", help="DIR:Char,Char — copy those characters' lines from an earlier run (so only the other voice changes)")
    ap.add_argument("--only", help="comma-separated shot ids to (re)record")
    a = ap.parse_args()
    proj = os.path.abspath(a.project)
    shots = json.load(open(os.path.join(proj, "shots.json")))
    talk = [s for s in shots if s.get("line")]

    if a.samples:                                   # audition mode
        cands = json.load(open(a.samples))
        out = os.path.join(proj, "samples"); os.makedirs(out, exist_ok=True)
        for who, voices in cands.items():
            first = next((s for s in talk if s["who"] == who), None)
            if not first: continue
            text = L.tags_for(first) + first["line"]
            for v in voices:
                data = L.tts(v["id"], a.model, text, stability=a.stability, similarity=a.similarity, lang=a.lang)
                name = f"{who}-{v['name'].split(' – ')[0].replace(' ', '-')}.mp3"
                open(os.path.join(out, name), "wb").write(data)
                print(f"{name:40} {len(data) * 8 / 128000:4.1f}s  «{first['line'][:50]}»")
        return

    voices = json.load(open(a.voices))
    out = os.path.join(proj, a.out); raw = os.path.join(out, "raw"); os.makedirs(raw, exist_ok=True)
    only = set(a.only.split(",")) if a.only else None
    reuse_dir, reuse_chars = (None, set())
    if a.reuse:
        d, _, chars = a.reuse.partition(":"); reuse_dir, reuse_chars = os.path.abspath(d), set(chars.split(","))
    tk = os.path.join(out, "takes.json")
    takes = json.load(open(tk)) if os.path.exists(tk) else {}   # merge on partial reruns
    print(f"{'shot':5} {'who':8} {'sec':>5}  diff  take  heard")
    for i, s in enumerate(talk):
        sid, who = s["id"], s["who"]
        dst = os.path.join(raw, f"{sid}.mp3")
        if only and sid not in only and os.path.exists(dst): continue
        if reuse_dir and who in reuse_chars and os.path.exists(os.path.join(reuse_dir, "raw", f"{sid}.mp3")):
            shutil.copy(os.path.join(reuse_dir, "raw", f"{sid}.mp3"), dst)
            print(f"{sid:5} {who:8} {L.duration(dst):5.1f}  reused from {os.path.basename(reuse_dir)}"); continue
        if who not in voices: raise SystemExit(f"no voice configured for {who}")
        spoken = s.get("say") or s["line"]          # "say" = pronunciation override; the subtitle keeps "line"
        text = L.tags_for(s) + spoken
        prev = L.strip_tags(L.tags_for(talk[i - 1]) + talk[i - 1]["line"]) if i else None
        nxt = L.strip_tags(talk[i + 1]["line"]) if i + 1 < len(talk) else None
        best = None
        for attempt, seed in enumerate([None, 11, 22, 33, 44][: a.retries + 1]):
            data = L.tts(voices[who]["id"], a.model, text, prev, nxt, a.stability, a.similarity, a.speed, a.lang, seed)
            tmp = dst + ".try.mp3"; open(tmp, "wb").write(data)
            said = L.transcribe(tmp)
            bad = L.diff_score(spoken, said) + (10 if L.leaked(text, said) else 0)
            if best is None or bad < best[0]:
                best = (bad, attempt, said); os.replace(tmp, dst)
            else:
                os.remove(tmp)
            if bad == 0: break
        takes[sid] = {"who": who, "voice": voices[who].get("name", voices[who]["id"]), "text": text,
                      "diff": best[0], "take": best[1] + 1, "heard": best[2]}
        flag = "" if best[0] == 0 else "  <-- CHECK"
        print(f"{sid:5} {who:8} {L.duration(dst):5.1f}  {best[0]:>4}  {best[1] + 1:>4}  {best[2][:56]}{flag}")
    json.dump(takes, open(tk, "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
