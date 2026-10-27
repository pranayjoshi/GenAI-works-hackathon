#!/usr/bin/env bash
# Rebuild the demo video from the recordings in media/rec: voiceover, cut, checks.
set -euo pipefail
cd "$(dirname "$0")/../.."
node --env-file=.env scripts/video/vo.mjs
node scripts/video/build.mjs
node scripts/video/check.mjs
