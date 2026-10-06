#!/usr/bin/env python3
"""Generate sound effects and a music bed with ElevenLabs.

Music must be LONGER than the video or the last seconds go silent — pass the
final duration plus a second. Regenerate it whenever the cut changes length.

Usage:
  ELEVENLABS_API_KEY=... python3 sfx_music.py --sfx out/sfx --music out/music.mp3 --music-seconds 45
"""
import argparse, json, os, sys, urllib.request

SFX = [
    ("pop", "short soft UI pop, bubbly, clean, minimal, high quality", 0.8),
    ("tap", "subtle phone screen tap click, soft, clean UI", 0.6),
    ("type", "short soft keyboard typing on phone, three taps, gentle", 1.2),
    ("ping", "gentle notification ping, two soft bell tones, modern smartphone alert, clean", 1.4),
    ("success", "soft success chime, positive confirmation, short rising marimba sparkle, clean", 1.6),
    ("ring", "phone dial tone busy, old telephone ringing, short, muffled", 1.2),
]
MUSIC = ("Warm uplifting minimal corporate advertising bed for a health app. Soft marimba and gentle "
         "plucks, airy pads, light clicky percussion, hopeful and modern, 105 bpm, clean mix with plenty "
         "of space for a voiceover, calm start, gentle build, resolves on a warm final chord. "
         "No vocals, no lyrics.")

def post(url, key, body, out, timeout=600):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        open(out, "wb").write(r.read())
    print(out, f"{os.path.getsize(out)/1024:.0f} KB")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sfx"); ap.add_argument("--music"); ap.add_argument("--music-seconds", type=float, default=45)
    a = ap.parse_args()
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("ELEVENLABS_API_KEY missing")
    if a.sfx:
        os.makedirs(a.sfx, exist_ok=True)
        for name, prompt, dur in SFX:
            post("https://api.elevenlabs.io/v1/sound-generation", key,
                 {"text": prompt, "duration_seconds": dur, "prompt_influence": 0.6},
                 os.path.join(a.sfx, f"{name}.mp3"))
    if a.music:
        post("https://api.elevenlabs.io/v1/music", key,
             {"prompt": MUSIC, "music_length_ms": int(a.music_seconds * 1000)}, a.music)

if __name__ == "__main__":
    main()
