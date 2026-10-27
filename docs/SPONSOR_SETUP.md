# Turning on the hosted sponsor paths

Ripple runs fully offline on local Nemotron 3 Nano 4B and an in-process DuckDB. The three paths below are coded and wired, but each needs credentials only the account owner can create. Each one is picked up automatically on the next start, with no code change.

## 1. NVIDIA hosted Nemotron (the three-model roles)

1. Get a key at build.nvidia.com (it starts with `nvapi-`).
2. Put it in Nightshift's Providers tab (step 2 below), not in this project. The app holds no NVIDIA key; it only needs the Nightshift URL and token.
3. Check it:

```bash
npm run probe
```

The roles then map to:

| Role | Model |
|---|---|
| crowd, voice | `nvidia/nemotron-3.5-lightning-30b-a3b` (thinking off) |
| reason, rewriter | `nvidia/nemotron-3-ultra-550b-a55b` (Nightshift serves Lightning and Ultra; it excludes the Super VL id) |
| interview | `nvidia/nemotron-3.5-lightning-30b-a3b` (thinking off) |
| review (report critic, honesty check) | `nvidia/nemotron-3-ultra-550b-a55b` |

Every call logs `served_by` in `runs/trace.jsonl` and in the Nemotron panel, so the role split is visible.

## 2. Nightshift (first provider in the chain; the hackathon rules require it as the primary provider)

1. Download the Mac M1+ edition from meterless.ai/mac.html (`Nightshift-Setup-mac-m1.dmg`, 17.8 MB, built 25 Oct). It is not notarized yet, so macOS blocks the first open: double-click Nightshift Setup, click Done, then System Settings > Privacy & Security > "Open Anyway" and confirm with your password. Setup copies Nightshift into Applications.
2. Start Nightshift. It serves `http://127.0.0.1:8088/v1`.
3. Paste the `nvapi-` key into Setup > Providers > Cloud provider keys > NVIDIA, then restart Nightshift once.
4. Copy the key from Nightshift > Console (⌘5) > API key into `.env` as `NIGHTSHIFT_TOKEN=...`. Without it the runtime answers 401 `runtime_token_missing`. If unset, the token is read from Nightshift's `proxy-token` file (`~/Library/Application Support/ai.meterless.runtime/`, then the older locations), or from `NIGHTSHIFT_TOKEN` / `NIGHTSHIFT_STATE_DIR` if set. Calls carry `meterless-app: dryrun`.
5. `npm run probe` should show `nightshift ONLINE` and `served_by=nightshift:...` for each role.

Observed 27 Oct: Nightshift served the crowd, voice, reason and review roles on Lightning and Ultra (`npm run probe`), and refused the Super VL id (`model_excluded`), so Ripple no longer asks for it. Known issue on M1-M4 builds (Meterless/Meterless issue #4, version 0.92.0): NVIDIA models may be missing from Nightshift's lane picker. Ripple asks for the model id directly, so this may not matter; if Nightshift refuses the ids, calls fall through to local Ollama and `served_by` says so.

## 3. Zetaris (federated SQL)

1. Register at cloud.enterprise.zetaris.com and download the "Run locally" platform bundle. It includes the Docker registry sign-in (`docker login`); the public Freemium repo's images (`zetaris/lightning-*`) are private on Docker Hub until Zetaris approves access, which can take up to 24 hours.
2. Start Docker Desktop and give it 10 GB of memory (Settings > Resources). On Apple Silicon, preflight always warns that the images are amd64; with "Use Rosetta" on (the default) that warning needs no action.
3. Mount this project into the bundle, then start it:

```bash
scripts/zetaris-mount.sh ~/Downloads/zetaris-platform
```

```bash
cd ~/Downloads/zetaris-platform && docker compose up -d
```

   The script writes a `docker-compose.override.yml` that mounts the project read-only at `/home/zetaris/customer-data/shared/dryrun` in the Lightning server and API containers.
4. Sign in to the Zetaris UI, create a token under Management > API Tokens, and put it in `.env` as `ZETARIS_API_KEY=...` (or set `ZETARIS_USER` / `ZETARIS_PASSWORD`). `.env` already has `ZETARIS_BASE_URL=http://localhost:8888` (8888, not 8889), `ZETARIS_ORG_ID=1` and `ZETARIS_FILE_ROOT=/home/zetaris/customer-data/shared/dryrun`.
5. Register the source tables (about 90 seconds; the REST API only runs SELECT, so this goes through the driver's `lightning-sql` CLI):

```bash
scripts/zetaris-register.sh ~/Downloads/zetaris-platform
```

   It creates one Lightning database, `dryrun`, with `census_acs`, `pew_platform_use`, `priors_behaviour`, `biz_customers` and `upworthy_tests` as file-store tables over the mounted CSVs, and writes `data/cache/zetaris-registered.json`. The app rewrites `pew.platform_use` to `dryrun.pew_platform_use` and so on when it sends a query to Zetaris. Lightning has no `IF NOT EXISTS`, and dropping a file-store table breaks its catalog, so to register again use a new database name: `ZETARIS_DB=dryrun2 scripts/zetaris-register.sh ...`. Run tables (`sim.*`) and a customer file other than the café demo stay on DuckDB and are labelled so.
6. `npm run probe` reports the engine. Every query in `runs/queries.jsonl` records whether `zetaris` or `local-duckdb` answered it, and the UI shows the same label.

The client follows the published OpenAPI spec (`/api/v1.0/auth/login`, `/api/v1.0/query/sql/start`, `/query/sql/page`, `/query/sql/close/{queryToken}`) and is checked against a fake server built from that spec in `tests/zetaris-contract.test.ts`. It also runs live against the local hackathon bundle (Zetaris 2.4.3): all five source tables answer through `zetaris` with the same row counts as DuckDB. The REST API returns every value as text, so the client turns numeric strings back into numbers.

A query goes to Zetaris only when every table it names is registered there. If Zetaris rejects one query, for example a DuckDB-only function, that query falls back to DuckDB and the log records why. An auth or network failure switches the rest of the process to DuckDB, so a run never dies on it.

## After any of these is on

Re-record the sample-mode replays so the offline demo uses the hosted answers:

```bash
npm run run:ab -- --crowd 600 --rounds 12 --seeds 2
```
