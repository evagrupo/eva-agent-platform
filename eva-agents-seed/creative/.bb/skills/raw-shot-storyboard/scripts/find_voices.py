#!/usr/bin/env python3
"""List candidate voices from the ElevenLabs shared library for a role.

  find_voices.py [--lang es] [--accent peninsular] [--gender female] [--age young] [--use conversational,social_media] [--top 25] [--previews DIR]

Sorts by how many people use each voice. Pick 2–3 per character, then audition them on the
character's actual first line with:  voices.py <project> --samples candidates.json
Metadata (age, descriptive, use case) helps shortlist, but only listening decides.
"""
import argparse, json, os, subprocess, sys, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

ap = argparse.ArgumentParser()
ap.add_argument("--lang", default="es"); ap.add_argument("--accent", default="peninsular")
ap.add_argument("--gender", default="female"); ap.add_argument("--age")
ap.add_argument("--use", default="conversational,social_media,advertisement,"); ap.add_argument("--top", type=int, default=25)
ap.add_argument("--previews")
a = ap.parse_args()
seen = {}
for uc in a.use.split(","):
    p = {"page_size": 100, "language": a.lang, "gender": a.gender}
    if uc: p["use_cases"] = uc
    if a.age: p["age"] = a.age
    out = subprocess.run(["curl", "-s", "-H", f"xi-api-key: {L.api_key()}",
                          "https://api.elevenlabs.io/v1/shared-voices?" + urllib.parse.urlencode(p)], capture_output=True, text=True).stdout
    for v in json.loads(out or "{}").get("voices", []): seen[v["voice_id"]] = v
rows = [v for v in seen.values() if a.accent.lower() in (v.get("accent") or "").lower()]
rows.sort(key=lambda v: -(v.get("cloned_by_count") or 0))
print(f"{len(rows)} voices ({a.lang}, {a.accent}, {a.gender})")
print(f"{'id':22} {'name':40} {'age':12} {'descriptive':14} {'use':16} used")
for v in rows[: a.top]:
    print(f"{v['voice_id']:22} {v['name'][:39]:40} {str(v.get('age'))[:11]:12} {str(v.get('descriptive'))[:13]:14} {str(v.get('use_case'))[:15]:16} {v.get('cloned_by_count')}")
    if a.previews and v.get("preview_url"):
        os.makedirs(a.previews, exist_ok=True)
        subprocess.run(["curl", "-s", "-o", os.path.join(a.previews, f"{v['voice_id']}.mp3"), v["preview_url"]])
