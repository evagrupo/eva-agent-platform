#!/usr/bin/env python3
"""Serve a folder for sharing animatics and listening pages. Unlike `python -m http.server`
it supports HTTP Range requests, which browsers need to play and seek video (Safari will not
play mp4 without them), and it sends no-store caching.

  serve.py <folder> [port=8804]      then, in bb:  bb connect expose <port>
Only files inside <folder> are served; there is no directory listing.
"""
import functools, http.server, os, re, sys

class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        rng = self.headers.get("Range")
        if os.path.isdir(path):
            idx = os.path.join(path, "index.html")
            if not os.path.exists(idx): self.send_error(404); return None
            path = idx
        if not os.path.exists(path): self.send_error(404); return None
        size = os.path.getsize(path); ctype = self.guess_type(path)
        # no-store breaks Chrome's media loader (the video stalls at loadstart), so only HTML gets it
        cache = "no-store" if ctype.startswith("text/") else "no-cache"
        m = re.match(r"bytes=(\d*)-(\d*)", rng or "")
        f = open(path, "rb")
        if not m:
            self.send_response(200)
            self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(size))
            self.send_header("Accept-Ranges", "bytes"); self.send_header("Cache-Control", cache); self.end_headers()
            return f
        a, b = m.group(1), m.group(2)
        start = int(a) if a else max(size - int(b), 0)
        end = int(b) if (a and b) else size - 1
        end = min(end, size - 1)
        if start > end or start >= size: self.send_error(416); f.close(); return None
        self.send_response(206)
        self.send_header("Content-Type", ctype); self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}"); self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", cache); self.end_headers()
        f.seek(start); self._remaining = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "_remaining", None)
        try:
            if left is None: return super().copyfile(source, outputfile)
            while left > 0:
                chunk = source.read(min(65536, left))
                if not chunk: break
                outputfile.write(chunk); left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass     # the player closed the connection (seeking) — normal
        finally:
            self._remaining = None

    def log_message(self, *a): pass

if __name__ == "__main__":
    folder = os.path.abspath(sys.argv[1]); port = int(sys.argv[2]) if len(sys.argv) > 2 else 8804
    http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(H, directory=folder)).serve_forever()
