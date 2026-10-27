#!/usr/bin/env bash
# Mount this project read-only into a local Zetaris bundle at /data/dryrun, so Zetaris can read
# the Census, Pew, priors, customer and run CSVs as Lightning file-store tables (ZETARIS_FILE_ROOT=/data/dryrun).
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
    if any(k in (s.get("image") or "") for k in ("lightning-server", "lightning-api", "driver", "spark")): print(name)')
[ -n "$services" ] || { echo "no Lightning server/API service found in the compose file"; exit 1; }

{
  echo "# Written by Dry Run scripts/zetaris-mount.sh"
  echo "services:"
  for s in $services; do
    echo "  $s:"
    echo "    volumes:"
    echo "      - \"$project:/data/dryrun:ro\""
  done
} > docker-compose.override.yml

echo "Wrote $bundle/docker-compose.override.yml for: $(echo $services | tr '\n' ' ')"
echo "Restart to apply:  (cd \"$bundle\" && docker compose up -d)"
