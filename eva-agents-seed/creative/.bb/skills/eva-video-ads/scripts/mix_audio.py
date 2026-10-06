#!/usr/bin/env python3
"""Pre-mix voice-over + music + sound effects into ONE track (public/audio/mix.mp3).

Why one track: the Remotion Player has to buffer every <Audio> tag before it
advances. With ~30 separate tags the preview freezes at 0:01 and never plays —
it looks like a crash. One mixed file removes the problem completely and also
makes the browser preview identical to the render.

Reads a timeline JSON (frames, 30fps by default):

{
  "fps": 30,
  "durationInFrames": 1328,
  "music": "public/audio/music.mp3",
  "vo":  [[8, "public/audio/v3/h1.mp3"], [108, "public/audio/v3/h2.mp3"]],
  "sfx": [[58, "public/audio/sfx/pop.mp3", 0.24], [112, "public/audio/sfx/ring.mp3", 0.18]],
  "out": "public/audio/mix.mp3"
}

It automatically trims the silence baked into each effect (ping and success ship
with 1.4–1.6 s of it, which made every sound land late), ducks the music under
every voice line, and fades in/out.

Usage: python3 mix_audio.py timeline.json
Note: uses Remotion's bundled ffmpeg, whose filter set is trimmed — no afade, no
alimiter — so fades and the duck are one volume expression.
"""
import json, os, subprocess, sys

def duration(path):
    """Seconds, from the CBR bitrate (avoids depending on ffprobe being present)."""
    return os.path.getsize(path) * 8 / 128000

def lead_silence(path):
    out = subprocess.run(["npx", "--yes", "remotion", "ffmpeg", "-i", path,
                          "-af", "silencedetect=noise=-40dB:d=0.02", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    for line in out.splitlines():
        if "silence_start: 0" in line:
            continue
        if "silence_end" in line:
            try:
                return float(line.split("silence_end:")[1].split()[0])
            except Exception:
                return 0.0
    return 0.0

def main():
    t = json.load(open(sys.argv[1]))
    fps = t.get("fps", 30)
    total = t["durationInFrames"] / fps
    out = t.get("out", "public/audio/mix.mp3")

    inputs, filters, labels = [], [], []
    inputs += ["-i", t["music"]]
    duck = "+".join(
        f"between(t,{at/fps-0.25:.2f},{at/fps+duration(src)+0.35:.2f})" for at, src in t["vo"]
    )
    quiet, loud = t.get("duckVolume", 0.17), t.get("musicVolume", 0.36)
    filters.append(
        f"[0:a]volume='(if({duck},{quiet},{loud}))*min(1,t/0.8)*min(1,max(0,({total:.2f}-t)/2.2))':eval=frame,"
        f"atrim=0:{total},apad=whole_dur={total}[music]"
    )
    labels.append("[music]")

    idx = 1
    for at, src in t["vo"]:
        inputs += ["-i", src]
        ms = int(at / fps * 1000)
        filters.append(f"[{idx}:a]adelay={ms}|{ms},volume=1.0[v{idx}]")
        labels.append(f"[v{idx}]"); idx += 1

    leads = {}
    for at, src, vol in t["sfx"]:
        if src not in leads:
            leads[src] = lead_silence(src)
        inputs += ["-i", src]
        ms = int(at / fps * 1000)
        filters.append(
            f"[{idx}:a]atrim=start={leads[src]:.3f},asetpts=PTS-STARTPTS,adelay={ms}|{ms},volume={vol}[s{idx}]"
        )
        labels.append(f"[s{idx}]"); idx += 1

    filters.append("".join(labels) +
                   f"amix=inputs={len(labels)}:duration=longest:normalize=0,volume=0.9,"
                   f"atrim=0:{total},aresample=48000[out]")

    music_len = duration(t["music"])
    if music_len < total:
        print(f"WARNING: music is {music_len:.1f}s but the video is {total:.1f}s — regenerate it longer")

    cmd = ["npx", "remotion", "ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters),
           "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", out]
    print(f"mixing {len(labels)} tracks -> {out} ({total:.2f}s)")
    for src, lead in leads.items():
        if lead > 0.05:
            print(f"  trimmed {lead:.2f}s of silence from {os.path.basename(src)}")
    sys.exit(subprocess.run(cmd).returncode)

if __name__ == "__main__":
    main()
