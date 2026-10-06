"""Shared helpers for the voice and animatic scripts (ElevenLabs v4, ffmpeg, speech-to-text QA)."""
import difflib, json, os, re, shutil, subprocess, time, urllib.error, urllib.request

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = re.compile(r"\[([^\]]+)\]")
NUMWORDS = set("""cero uno una un dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince
dieciséis diecisiete dieciocho diecinueve veinte veintiuno veintidós veintitrés veinticuatro veinticinco treinta
cuarenta cincuenta sesenta setenta ochenta noventa cien ciento mil euros euro céntimos con""".split())

def api_key():
    k = os.environ.get("ELEVENLABS_API_KEY")
    if not k:
        raise SystemExit("ELEVENLABS_API_KEY missing: export it, or ask the user for it (never print it)")
    return k

def ffmpeg_bin():
    """Find an ffmpeg binary: $FFMPEG, system ffmpeg, then the one bundled with Remotion
    (node_modules/@remotion/compositor-*/ffmpeg) found from the cwd upward or in ~/Developer/*.
    `npx remotion ffmpeg` is NOT used: it only works inside a project that has Remotion installed."""
    import glob
    if os.environ.get("FFMPEG"): return os.environ["FFMPEG"]
    if shutil.which("ffmpeg"): return "ffmpeg"
    roots, d = [], os.getcwd()
    while True:
        roots.append(d)
        if os.path.dirname(d) == d: break
        d = os.path.dirname(d)
    pats = [os.path.join(r, "node_modules/@remotion/compositor-*/ffmpeg") for r in roots]
    pats.append(os.path.expanduser("~/Developer/*/node_modules/@remotion/compositor-*/ffmpeg"))
    pats.append(os.path.expanduser("~/*/node_modules/@remotion/compositor-*/ffmpeg"))
    for pat in pats:
        hits = sorted(h for h in glob.glob(pat) if os.access(h, os.X_OK))
        gnu = [h for h in hits if "gnu" in h or "darwin" in h or "win32" in h]
        if gnu or hits: return (gnu or hits)[0]
    raise SystemExit("No ffmpeg found. Install ffmpeg, or run `npm i @remotion/cli` in any folder, or set FFMPEG=/path/to/ffmpeg")

def ffmpeg():
    return [ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error"]

def ffprobe_text(path, *extra):
    return subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", path, *extra], capture_output=True, text=True).stderr

def duration(path):
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", ffprobe_text(path))
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])

def speech_window(path):
    """(start, end) seconds of actual speech, found with silencedetect."""
    err = ffprobe_text(path, "-af", "silencedetect=noise=-40dB:d=0.04", "-f", "null", "-")
    total = duration(path)
    st = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    en = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    lead = en[0] if st and st[0] < 0.05 and en else 0.0
    tail = st[-1] if st and (not en or st[-1] > en[-1]) else total
    return max(lead - 0.04, 0.0), min(tail + 0.06, total)

def strip_tags(text):
    return re.sub(r"\s+", " ", TAG.sub("", text)).strip()

def tts(voice, model, text, prev=None, nxt=None, stability=0.45, similarity=0.8, speed=1.0, lang="es", seed=None):
    body = {"text": text, "model_id": model,
            "voice_settings": {"stability": stability, "similarity_boost": similarity,
                               "use_speaker_boost": True, "speed": speed}}
    if lang: body["language_code"] = lang
    if prev: body["previous_text"] = prev
    if nxt: body["next_text"] = nxt
    if seed is not None: body["seed"] = seed
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps(body).encode(), headers={"xi-api-key": api_key(), "Content-Type": "application/json"})
    for attempt in range(5):                         # ride out DNS / network blips and 429/5xx
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 4: time.sleep(4 * (attempt + 1)); continue
            raise SystemExit(f"ElevenLabs error {e.code}: {e.read()[:300].decode()}")
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 4: raise
            time.sleep(4 * (attempt + 1))

def transcribe(path):
    """curl, not urllib: the WAF in front of the API 403s urllib's user agent."""
    out = subprocess.run(["curl", "-s", "-X", "POST", "https://api.elevenlabs.io/v1/speech-to-text",
                          "-H", f"xi-api-key: {api_key()}", "-F", "model_id=scribe_v1",
                          "-F", "language_code=spa", "-F", f"file=@{path}"], capture_output=True, text=True).stdout
    try:
        return json.loads(out).get("text", "")
    except Exception:
        return ""

def tokens(s):
    s = TAG.sub("", s.lower())
    return [w for w in re.sub(r"[^a-záéíóúñü0-9 ]", " ", s).split() if not w.isdigit()]

def diff_score(expected, said):
    """Number of word differences between the script and what was heard (0 = exact).
    Spelled-out numbers the model added or the STT wrote as words are ignored, because
    '34,40' is read aloud as 'treinta y cuatro cuarenta'. A doubled or dropped word counts."""
    a, b = tokens(expected), tokens(said)
    bad = 0
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if op == "equal": continue
        seg = a[i1:i2] + b[j1:j2]
        if all(w in NUMWORDS or w == "y" for w in seg): continue
        bad += max(i2 - i1, j2 - j1)
    return bad

def leaked(text, said):
    words = {w.strip().lower() for t in TAG.findall(text) for w in t.split(",") if w.strip()}
    said = said.lower()
    return sorted(w for w in words if re.search(r"\b" + re.escape(w) + r"\b", said))

# Spanish direction (as written in shots.json "emotion") -> Eleven v4 audio tags.
# One emotion per segment, qualifiers comma-separated inside the same bracket.
TAGMAP = {
 "sorprendida": "surprised", "escéptica": "disbelief", "escéptico": "disbelief", "curiosa": "curious", "curioso": "curious",
 "segura": "confident", "seguro": "confident", "amable": "warm", "cálida": "warm", "cálido": "warm", "cercana": "friendly",
 "cercano": "friendly", "tranquilizadora": "trusting", "hastiada": "sarcastic", "con humor": "playful", "dudosa": "uncertain",
 "dudoso": "uncertain", "aliviada": "relieved", "aliviado": "relieved", "contenta": "happy", "contento": "happy",
 "cómplice": "playful", "directa": "confident", "directo": "confident", "clara": "confident", "con ritmo": "snappy",
 "preocupada": "worried", "preocupado": "worried", "agobiada": "stressed", "cansada": "tired", "cansado": "tired",
 "frustrada": "frustrated", "frustrado": "frustrated", "entusiasmada": "excited", "animada": "excited", "alegre": "happy",
 "tierna": "tender", "susurrando": "whispers", "susurrado": "whispers", "serena": "peaceful", "orgullosa": "proud",
 "divertido": "playful", "divertida": "playful", "irónica": "sarcastic", "irónico": "sarcastic", "triste": "sad",
 "resignada": "tired", "enfadada": "mad", "ilusionada": "optimistic", "optimista": "optimistic", "emocionada": "excited",
}

def tags_for(shot):
    """[tags] for a shot: explicit "tags" wins; otherwise derive from the "emotion" field."""
    if shot.get("tags"):
        return f"[{shot['tags']}] "
    emo = (shot.get("emotion") or "").lower()
    parts = [t.strip() for t in re.split(r"[,/]", emo) if t.strip()]
    mapped = [TAGMAP[p] for p in parts if p in TAGMAP] or parts[:2]
    return f"[{', '.join(mapped)}] " if mapped else ""
