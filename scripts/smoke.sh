#!/usr/bin/env bash
# Offline smoke test. Records nothing and calls no model: it replays a recorded café run (40 people, 6 rounds,
# competitor event at round 4) from samples/smoke-recordings.sqlite in strict mode, so any call that was not
# recorded fails, and checks the verdict matches the recorded run.
set -euo pipefail
cd "$(dirname "$0")/.."
export DOTENV_CONFIG_PATH=/nonexistent  # ignore the local .env: a configured Zetaris changes the data path
export SAMPLE_MODE=true SAMPLE_STRICT=true REPLAY_CROWD_MS=0 PROVIDERS=none RECORD=false QUIET_AGENT_LOG=true QUIET_AGENT_LOG=true
export RECORDINGS_DB=${RECORDINGS_DB:-samples/smoke-recordings.sqlite}
npx tsc --noEmit
npx vitest run
want="B leads on intent to visit: 34.2% vs 15.8% (+18.4 pts, 95% CI −0.6 to +37.4); B ahead in 1 of 1 seed; 97% likely to be the better version."
got=$(npx tsx scripts/run-ab.ts --crowd 40 --rounds 6 --seeds 1 \
  --event "3|Bean There, the cafe across the street, just posted 30% off all lattes today only" | tee /dev/stderr | grep '^VERDICT:' | sed 's/^VERDICT: //')
if [ "$got" = "$want" ]; then echo "SMOKE OK: offline replay reproduced the recorded run: $got"; else echo "SMOKE MISMATCH"; echo " recorded: $want"; echo " replay:   $got"; exit 1; fi
