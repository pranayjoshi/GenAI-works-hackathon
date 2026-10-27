#!/usr/bin/env bash
# Mount this project read-only into a local Zetaris bundle at /home/zetaris/customer-data/shared/dryrun (inside Zetaris's allowed file root), so Zetaris can read
# the Census, Pew, priors, customer and run CSVs as Lightning file-store tables (ZETARIS_FILE_ROOT=/home/zetaris/customer-data/shared/dryrun).
# Usage: scripts/zetaris-mount.sh <folder with the Zetaris docker-compose.yml>
set -euo pipefail
bundle="${1:?usage: scripts/zetaris-mount.sh <zetaris bundle folder>}"
project="$(cd "$(dirname "$0")/.." && pwd)"
cd "$bundle"
[ -f docker-compose.yml ] || [ -f compose.yml ] || { echo "no compose file in $bundle"; exit 1; }

# Every service that runs the Lightning engine or the API needs to see the files.
services=$(docker compose config --format json | python3 -c '
import json, sys
for name, s in json.load(sys.stdin)["services"].items():
    if name in ("init", "bootstrap"): continue   # one-shot setup jobs
    if any(k in (s.get("image") or "") for k in ("lightning-server", "lightning-api", "ndp-driver", "ndp-api")): print(name)')
[ -n "$services" ] || { echo "no Lightning server/API service found in the compose file"; exit 1; }

{
  echo "# Written by Dry Run scripts/zetaris-mount.sh"
  echo "services:"
  for s in $services; do
    echo "  $s:"
    echo "    volumes:"
    echo "      - \"$project:/home/zetaris/customer-data/shared/dryrun:ro\""
  done
} > docker-compose.override.yml

echo "Wrote $bundle/docker-compose.override.yml for: $(echo $services | tr '\n' ' ')"
echo "Restart to apply:  (cd \"$bundle\" && docker compose up -d)"
