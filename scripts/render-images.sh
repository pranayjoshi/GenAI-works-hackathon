#!/usr/bin/env bash
# Render the README illustrations (docs/images/src/*.html, 1600 x 900) to docs/images/*.jpg with headless Chrome.
# Needs Google Chrome and ffmpeg. Usage: bash scripts/render-images.sh [hero agents evidence]
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
for name in "${@:-hero agents evidence}"; do
  for n in $name; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1600,900 \
      --virtual-time-budget=8000 --screenshot="$tmp/$n.png" "file://$PWD/docs/images/src/$n.html" >/dev/null 2>&1
    ffmpeg -loglevel error -y -i "$tmp/$n.png" -q:v 3 "docs/images/$n.jpg"
    echo "docs/images/$n.jpg"
  done
done
rm -rf "$tmp"
