#!/usr/bin/env bash
# Offline smoke test: replays the recorded demo run from samples/recordings.sqlite with no model provider.
set -euo pipefail
cd "$(dirname "$0")/.."
export SAMPLE_MODE=true SAMPLE_STRICT=true REPLAY_CROWD_MS=0 PROVIDERS=none
npx tsc --noEmit
npx vitest run
npx tsx scripts/run-ab.ts ${SMOKE_ARGS:---crowd 24 --rounds 6 --seeds 1}
