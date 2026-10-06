#!/usr/bin/env python3
"""Generate or fix ad photos with the OpenAI Images API (default model: gpt-image-2.5).

For agents that cannot generate images natively (e.g. Claude). Codex and other agents
with built-in image generation should use their own tool instead.

The API key is read from the OPENAI_API_KEY environment variable, or from a dotenv
file passed with --env-file (a line OPENAI_API_KEY=...). The key is never printed.

Generate:
  generate_image.py --prompt-file prompts/medica.txt --out site/img/ai/medica.png --n 3
Fix an existing image (edit with a reference image + correction prompt):
  generate_image.py --edit site/img/ai/medica.png --prompt "Keep everything, but ..." --out site/img/ai/medica.png

With --n > 1 the files are saved as name.png, name-v2.png, name-v3.png ... so you can pick the best.
"""
import argparse, base64, json, os, sys, time, uuid, urllib.request, urllib.error

API = "https://api.openai.com/v1/images"


def load_key(env_file):
    key = os.environ.get("OPENAI_API_KEY")
    if not key and env_file and os.path.exists(env_file):
        for line in open(env_file):
            line = line.strip()
            if line.startswith("OPENAI_API_KEY="):
                key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        sys.exit("OPENAI_API_KEY missing: ask the user for an OpenAI API key (set it as an env var or in a .env file). Do not paste it into chat logs or files that get shared.")
    return key


def request(url, key, body, content_type):
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": content_type})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(10 * (attempt + 1)); continue
            sys.exit(f"OpenAI API error {e.code}: {msg[:800]}")


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = bytearray()
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, path in files:
        mime = "image/png" if path.lower().endswith(".png") else "image/jpeg"
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{os.path.basename(path)}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
        out += open(path, "rb").read() + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={b}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt"); ap.add_argument("--prompt-file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--edit", action="append", help="reference image(s) to edit/fix")
    ap.add_argument("--model", default=os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2.5"))
    ap.add_argument("--size", default="1024x1536", help="portrait default; use the largest the model supports")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--env-file", default=".env")
    a = ap.parse_args()
    prompt = a.prompt or (open(a.prompt_file).read() if a.prompt_file else None)
    if not prompt:
        sys.exit("--prompt or --prompt-file required")
    key = load_key(a.env_file)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    fields = {"model": a.model, "prompt": prompt, "size": a.size, "quality": a.quality, "n": str(a.n)}
    if a.edit:
        body, ct = multipart(fields, [("image[]", p) for p in a.edit])
        res = request(f"{API}/edits", key, body, ct)
    else:
        fields["n"] = a.n
        res = request(f"{API}/generations", key, json.dumps(fields).encode(), "application/json")
    base, ext = os.path.splitext(a.out)
    saved = []
    for i, item in enumerate(res.get("data", [])):
        path = a.out if i == 0 else f"{base}-v{i + 1}{ext or '.png'}"
        if item.get("b64_json"):
            open(path, "wb").write(base64.b64decode(item["b64_json"]))
        elif item.get("url"):
            urllib.request.urlretrieve(item["url"], path)
        else:
            continue
        saved.append(path)
    if not saved:
        sys.exit(f"No image returned: {json.dumps(res)[:500]}")
    print("\n".join(saved))


if __name__ == "__main__":
    main()
