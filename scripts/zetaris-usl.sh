#!/usr/bin/env bash
# Build and check Ripple's Unified Semantic Layer (USL) on a local Zetaris bundle, and save receipts.
#   1. builds data/cache/census_usl.csv from the cached Census Reporter responses (US + 3 ZIPs)
#   2. onboards it as Lightning file-store table dryrun.census_acs_zips if it is not there yet
#   3. runs docs/zetaris-usl/sql/00..05 over JDBC (port 10000): source checks, exploratory queries,
#      COMPILE USL (the DDL), ACTIVATE USL TABLE, USL queries, data-quality rules (REGISTER / RUN DQ)
#   4. asks one USL question again through the REST API with the app's own client
#   5. writes every statement, the rows Zetaris returned and the time to docs/zetaris-usl/receipts.json
# Needs: the bundle running, scripts/zetaris-register.sh done once (database dryrun), Java 17+ on this machine,
# .env with ZETARIS_USER / ZETARIS_PASSWORD (and ZETARIS_BASE_URL for step 4).
# Usage: scripts/zetaris-usl.sh [zetaris bundle folder]   (default: found from the running driver container)
set -euo pipefail
project="$(cd "$(dirname "$0")/.." && pwd)"
bundle="${1:-$(docker inspect zetaris-driver-1 --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)}"
[ -n "$bundle" ] || { echo "usage: scripts/zetaris-usl.sh <zetaris bundle folder>"; exit 1; }
export ZETARIS_JDBC_JAR="${ZETARIS_JDBC_JAR:-$(ls "$bundle"/jdbc/ndp-jdbc-driver-*.jar | head -1)}"
command -v java >/dev/null || { echo "java 17+ is needed (it runs scripts/zetaris-usl/LightningRunner.java)"; exit 1; }
out="$project/docs/zetaris-usl"; rec="$out/receipts"; sqld="$out/sql"
mkdir -p "$rec"
run() { "$project/scripts/zetaris-usl/run.sh" "$1"; }

echo "1/5 census_usl.csv from cached Census responses"
(cd "$project" && node -e '
const fs=require("fs");const c="data/cache/";const rows=[];
for (const g of ["01000US","86000US78704","86000US60622","86000US43201"]) rows.push(...JSON.parse(fs.readFileSync(c+"census_"+g+".json","utf8")));
const cols=Object.keys(rows[0]);const cell=v=>{const t=v==null?"":String(v);return /[",\n]/.test(t)?`"${t.replace(/"/g,"\"\"")}"`:t};
fs.writeFileSync(c+"census_usl.csv",[cols.join(","),...rows.map(r=>cols.map(k=>cell(r[k])).join(","))].join("\n")+"\n");
console.log("   "+rows.length+" rows");')

echo "2/5 onboard dryrun.census_acs_zips (only if missing)"
probe="$(mktemp)"; printf -- '-- @id probe\nSELECT COUNT(*) AS n FROM dryrun.census_acs_zips\n' > "$probe"
# the onboarding receipt from the first run is kept; a later run only re-checks that the table answers
if run "$probe" | grep -q '"ok":true'; then echo "   already registered"
else run "$sqld/00_onboard_census_zips.sql" | tee "$rec/00_onboard_census_zips.jsonl" | cut -c1-160; fi
rm -f "$probe"

echo "3/5 source checks, exploration, USL DDL, activation, USL queries, data quality"
for f in 00_sources 01_explore 02_usl_ddl 03_activate 04_usl_queries 05_data_quality; do
  run "$sqld/$f.sql" > "$rec/$f.jsonl"
  echo "   $f: $(grep -c '"ok":true' "$rec/$f.jsonl") ok, $(grep -c '"ok":false' "$rec/$f.jsonl" || true) failed"
done

echo "4/5 USL query and DQ statements through the REST API (the app's client)"
(cd "$project" && npx tsx scripts/zetaris-usl/rest-check.ts 2>/dev/null | grep '^{') > "$rec/06_rest_api.jsonl" || true
echo "   $(grep -c '"ok":true' "$rec/06_rest_api.jsonl") ok, $(grep -c '"ok":false' "$rec/06_rest_api.jsonl" || true) failed"

echo "5/5 receipts.json"
(cd "$project" && node scripts/zetaris-usl/receipts.cjs)
echo "extras: hand-coded comparison (2a) and the MOCK quality table (2c)"
(cd "$project" && npx tsx scripts/usl-handcoded-compare.ts 2>/dev/null | tail -1 && node scripts/zetaris-usl/mock-quality-table.cjs)
echo "Done. docs/zetaris-usl/receipts.json"
