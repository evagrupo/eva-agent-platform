#!/bin/bash
# Scaffold an Eva Salud ads project: brand files + carousel template + approved photo library.
# Usage: init_project.sh <project_dir>
set -e
SKILL="$(cd "$(dirname "$0")/.." && pwd)"; P=$1
[ -z "$P" ] && { echo "usage: init_project.sh <project_dir>"; exit 1; }
mkdir -p "$P/site/fonts" "$P/site/img/ai" "$P/site/img/web" "$P/site/png"
cp "$SKILL"/brand/fonts/NotoSans-{Regular,Bold}.ttf "$P/site/fonts/"
cp "$SKILL"/brand/logos/{logo,logo-blanco,logo-negativo,hoja,hoja-blanca}.svg "$P/site/img/"
cp "$SKILL"/brand/fotos/*.jpg "$P/site/img/web/" 2>/dev/null || true
[ -f "$P/site/index.html" ] || cp "$SKILL/template/carousel.html" "$P/site/index.html"
cp "$SKILL/references/photo-brief.md" "$P/BRIEF.md" 2>/dev/null || true
echo "Project ready: $P/site (open index.html via: cd $P/site && python3 -m http.server 8765)"
