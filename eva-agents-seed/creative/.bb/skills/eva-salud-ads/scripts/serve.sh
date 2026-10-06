#!/bin/bash
# Serve a site folder with caching disabled (so updated logos/photos are never stale)
# and print a shareable URL when possible.
# Usage: serve.sh <site_dir> [port=8765]
DIR=$(cd "$1" && pwd); PORT=${2:-8765}
PID=$(lsof -ti tcp:$PORT 2>/dev/null || true); [ -n "$PID" ] && kill $PID 2>/dev/null && sleep 1
nohup python3 - "$DIR" "$PORT" >/dev/null 2>&1 <<'PY' &
import sys, functools, http.server
d, port = sys.argv[1], int(sys.argv[2])
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(H, directory=d)).serve_forever()
PY
sleep 1
echo "local: http://localhost:$PORT/"
# In bb, expose it to the user's remote browser; elsewhere the local URL is the answer.
command -v bb >/dev/null 2>&1 && bb connect expose "$PORT" 2>/dev/null | tail -1 || true
