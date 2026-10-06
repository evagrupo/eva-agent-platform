#!/usr/bin/env python3
"""Generate the voice-over with ElevenLabs Eleven v4, verify it, print frame-accurate durations.

A video is timed to its voice-over, so you need the real length of every line before
placing a single animation. This script generates each line, proves with speech-to-text
that the expression tags were NOT read aloud, and prints seconds AND frames.

Usage:
  ELEVENLABS_API_KEY=... python3 tts.py lines.json out_dir [--voice <id>] [--model eleven_v4]
                                         [--fps 30] [--stability 0.5] [--speed 1.0] [--compare old_dir]

lines.json (ORDER MATTERS — it is the script order):
  {"h1": "[anxious, hushed] Fiebre… a las tres de la mañana.",
   "h2": "[tired] Y tú, llamando a una clínica tras otra…"}

Eleven v4 best practices (ElevenLabs docs/blog, Oct 2026) built in here:
  * Tags are free-text direction in square brackets, placed BEFORE the clause they direct.
  * ONE emotion per sentence segment — contrasting emotions in one segment degrade the result.
    Qualifiers go in the same bracket, comma-separated: [whispering, fearful], [curious, hushed].
  * Describe voice quality explicitly ([low, gravelly]) rather than ambiguous cues.
  * A tag carries across the line, so one tag at the start is usually enough; add a new tag
    only where the tone turns. If a line does not land, SWAP THE TAG before rewriting words.
  * Pacing is punctuation and tags, not SSML: ellipses slow a line down, dashes cut it off,
    exclamation marks add intensity. v4 does not support <break> tags.
  * Neighbour context: each request carries previous_text/next_text (tags stripped) so
    delivery stays continuous across separately generated lines.
  * v4 keeps the speaker identity stable across regenerations (no vocal drift like v3).
  * `speed` accepts 0.7–1.2. Models: eleven_v4 for produced content, eleven_v4_turbo for
    real-time agents only.
"""
import argparse, json, os, re, subprocess, sys, urllib.request, urllib.error

TAG = re.compile(r"\[([^\]]+)\]")

def strip_tags(text):
    return re.sub(r"\s+", " ", TAG.sub("", text)).strip()

def synth(key, voice, model, text, prev, nxt, stability, similarity, speed, lang, seed):
    body = {"text": text, "model_id": model,
            "voice_settings": {"stability": stability, "similarity_boost": similarity,
                               "use_speaker_boost": True, "speed": speed}}
    if lang: body["language_code"] = lang
    if prev: body["previous_text"] = prev
    if nxt: body["next_text"] = nxt
    if seed is not None: body["seed"] = seed
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps(body).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()

def transcribe(path, key):
    """curl, not urllib: the WAF in front of the API 403s urllib's user agent."""
    out = subprocess.run(["curl", "-s", "-X", "POST", "https://api.elevenlabs.io/v1/speech-to-text",
                          "-H", f"xi-api-key: {key}", "-F", "model_id=scribe_v1",
                          "-F", "language_code=spa", "-F", f"file=@{path}"],
                         capture_output=True, text=True).stdout
    try:
        return json.loads(out).get("text", "")
    except Exception:
        return ""

def leaked_tags(text, said):
    said = said.lower()
    words = {w.strip().lower() for t in TAG.findall(text) for w in t.split(",") if w.strip()}
    return sorted(w for w in words if re.search(r"\b" + re.escape(w) + r"\b", said))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lines"); ap.add_argument("out_dir")
    ap.add_argument("--voice", default=os.environ.get("ELEVENLABS_VOICE_ID", "XJBmyUY9wnUyXvpFfZul"))
    ap.add_argument("--model", default="eleven_v4")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--stability", type=float, default=0.5)
    ap.add_argument("--similarity", type=float, default=0.8)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--lang", default="es")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--compare", help="folder with same-named .mp3 files to compare durations against")
    ap.add_argument("--no-verify", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("ELEVENLABS_API_KEY missing")
    os.makedirs(a.out_dir, exist_ok=True)
    lines = list(json.load(open(a.lines)).items())

    print(f"{'line':14} {'sec':>6} {'frames':>7} {'vs old':>8}  transcript check")
    for i, (slug, text) in enumerate(lines):
        prev = strip_tags(lines[i - 1][1]) if i else None
        nxt = strip_tags(lines[i + 1][1]) if i + 1 < len(lines) else None
        try:
            data = synth(key, a.voice, a.model, text, prev, nxt, a.stability, a.similarity, a.speed, a.lang, a.seed)
        except urllib.error.HTTPError as e:
            print(slug, "ERROR", e.code, e.read()[:200].decode()); continue
        path = os.path.join(a.out_dir, f"{slug}.mp3")
        open(path, "wb").write(data)
        secs = len(data) * 8 / 128000                       # 128 kbps CBR → seconds
        delta = ""
        if a.compare and os.path.exists(os.path.join(a.compare, f"{slug}.mp3")):
            old = os.path.getsize(os.path.join(a.compare, f"{slug}.mp3")) * 8 / 128000
            delta = f"{secs - old:+.2f}s"
        check = ""
        if not a.no_verify:
            said = transcribe(path, key)
            bad = leaked_tags(text, said)
            check = ("TAG SPOKEN " + ",".join(bad) + " → " if bad else "") + said[:60]
        print(f"{slug:14} {secs:6.2f} {round(secs * a.fps):7d} {delta:>8}  {check}")

if __name__ == "__main__":
    main()
