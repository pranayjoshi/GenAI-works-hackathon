#!/usr/bin/env bash
# Helper: run one .sql file (statements tagged "-- @id name") through LightningRunner over JDBC; prints JSON lines.
set -euo pipefail
project="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; . "$project/.env"; set +a
jar="${ZETARIS_JDBC_JAR:-${ZETARIS_BUNDLE:-$HOME/Downloads/zetaris-platform}/jdbc/ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar}"
ZE="${ZETARIS_USER:-admin@zetaris.com}" ZP="$ZETARIS_PASSWORD" java -cp "$jar" "$project/scripts/zetaris-usl/LightningRunner.java" "$1" 2>/dev/null
