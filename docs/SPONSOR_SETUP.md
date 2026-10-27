# Turning on the hosted sponsor paths

Dry Run runs fully offline on local Nemotron 3 Nano 4B and an in-process DuckDB. The three paths below are coded and wired, but each needs credentials only the account owner can create. Each one is picked up automatically on the next start, with no code change.

## 1. NVIDIA hosted Nemotron (the three-model roles)

1. Get a key at build.nvidia.com (it starts with `nvapi-`).
2. Put it in `.env` as `NVIDIA_API_KEY=...` (copy `.env.example` first).
3. Check it:

```bash
npm run probe
```

The roles then map to:

| Role | Model |
|---|---|
| crowd, voice | `nvidia/nemotron-3.5-lightning-30b-a3b` (thinking off) |
| reason, interview, rewriter | `nvidia/nemotron-3-super-120b-a12b` |
| review (report critic, honesty check) | `nvidia/nemotron-3-ultra-550b-a55b` |

Every call logs `served_by` in `runs/trace.jsonl` and in the Nemotron panel, so the role split is visible.

## 2. Nightshift (first provider in the chain)

1. Install the Nightshift Mac M1+ edition and start it. It listens on `http://127.0.0.1:8088/v1`.
2. Add the NVIDIA key in its Providers tab.
3. Nothing to set in Dry Run. The runtime token is read from Nightshift's `proxy-token` file, or from `NIGHTSHIFT_TOKEN` / `NIGHTSHIFT_STATE_DIR` if set.
4. `npm run probe` should show `nightshift ONLINE` and `served_by=nightshift:...`.

## 3. Zetaris (federated SQL)

1. Request access to the Zetaris Freemium Docker images (kbase.zetaris.com, "docker installation on docker desktop"), or use cloud credentials.
2. Set `ZETARIS_BASE_URL` (the API host), `ZETARIS_ORG_ID`, and either `ZETARIS_API_KEY` (preferred, the spec's query endpoints take an API token) or `ZETARIS_USER` and `ZETARIS_PASSWORD`.
3. Set `ZETARIS_FILE_ROOT` to the path where Zetaris sees this project's folder, for example a Docker volume mounted at `/data/dryrun`. Dry Run then registers the Census, Pew, priors, customer and run tables as Lightning file-store tables at that path. A hosted instance cannot read files on your laptop, so without this setting the tables stay on local DuckDB.
4. `npm run probe` reports the engine. Every query in `runs/queries.jsonl` records whether `zetaris` or `local-duckdb` answered it, and the UI shows the same label.

The client follows the published OpenAPI spec (`/api/v1.0/auth/login`, `/api/v1.0/query/sql/start`, `/query/sql/page`, `/query/sql/close/{queryToken}`) and is checked against a fake server built from that spec in `tests/zetaris-contract.test.ts`. It has not yet run against a live Zetaris instance.

A query goes to Zetaris only when every table it names is registered there. If Zetaris rejects one query, for example a DuckDB-only function, that query falls back to DuckDB and the log records why. An auth or network failure switches the rest of the process to DuckDB, so a run never dies on it.

## After any of these is on

Re-record the sample-mode replays so the offline demo uses the hosted answers:

```bash
npm run run:ab -- --crowd 600 --rounds 12 --seeds 2
```
