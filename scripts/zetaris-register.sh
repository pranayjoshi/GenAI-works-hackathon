#!/usr/bin/env bash
# Register Dry Run's source tables on a local Zetaris bundle as Lightning file-store tables over the
# project mount (/home/zetaris/customer-data/shared/dryrun, see scripts/zetaris-mount.sh). The REST API only runs SELECT, so DDL goes
# through the driver's lightning-sql CLI. Writes data/cache/zetaris-registered.json, which the app reads
# to decide which tables Zetaris answers.
# Usage: scripts/zetaris-register.sh <zetaris bundle folder>
set -euo pipefail
bundle="${1:?usage: scripts/zetaris-register.sh <zetaris bundle folder>}"
project="$(cd "$(dirname "$0")/.." && pwd)"
set -a; . "$project/.env"; set +a
root="${ZETARIS_FILE_ROOT:-/home/zetaris/customer-data/shared/dryrun}"

# table|file relative to the project
tables="pew.platform_use|data/sources/pew_platform_use.csv
priors.behaviour|data/sources/priors_behaviour.csv
biz.customers|data/sources/biz_customers_cafe.csv
upworthy.tests|data/raw/upworthy-exploratory.csv
census.acs|data/cache/census_all.csv
worldbank.country|data/cache/worldbank_all.csv"

sql="$project/data/cache/zetaris-register.sql"
json="$project/data/cache/zetaris-registered.json"
mkdir -p "$project/data/cache"
# One Lightning database holds every table as <schema>_<table>; the app rewrites names when it sends a query.
# Lightning has no IF NOT EXISTS and dropping a file-store table breaks its catalog, so to re-register,
# pass a new database name: ZETARIS_DB=dryrun2 scripts/zetaris-register.sh ...
zdb="${ZETARIS_DB:-dryrun}"
echo "CREATE LIGHTNING DATABASE $zdb DESCRIBE BY \"Dry Run sources\" OPTIONS ();" > "$sql"
echo "{" > "$json.tmp"; first=1
while IFS='|' read -r table file; do
  [ -f "$project/$file" ] || { echo "skip $table: $file missing"; continue; }
  db=${table%%.*}; t=${table#*.}
  # multiLine: the Upworthy headlines contain quoted line breaks
  printf 'CREATE LIGHTNING FILESTORE TABLE %s_%s FROM %s FORMAT csv OPTIONS (path "%s/%s", header "true", inferSchema "true", multiLine "true", escape "\\"");\n' "$db" "$t" "$zdb" "$root" "$file" >> "$sql"
  [ $first = 1 ] || echo "," >> "$json.tmp"; first=0
  printf '  "%s": { "zetaris": "%s.%s_%s", "path": "%s/%s" }' "$table" "$zdb" "$db" "$t" "$root" "$file" >> "$json.tmp"
done <<< "$tables"
echo "" >> "$json.tmp"; echo "}" >> "$json.tmp"

cd "$bundle"
echo "Registering $(grep -c FILESTORE "$sql") tables through lightning-sql (takes a minute or two)..."
docker compose exec -T driver mkdir -p /tmp/dryrun
docker compose cp "$sql" driver:/tmp/dryrun/register.sql >/dev/null
log="$project/data/cache/zetaris-register.log"
docker compose exec -T -e ZE="${ZETARIS_USER:-admin@zetaris.com}" -e ZP="$ZETARIS_PASSWORD" driver \
  bash -c 'bash "$ZETARIS_NDP_DRIVER_HOME/bin/lightning-sql.sh" --email "$ZE" --password "$ZP" -f /tmp/dryrun/register.sql' > "$log" 2>&1 || {
  echo "lightning-sql failed; see $log"; grep -aE "Exception|ERROR" "$log" | head -5; exit 1; }
mv "$json.tmp" "$json"
echo "Done. Wrote $json"
