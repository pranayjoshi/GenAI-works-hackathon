# Sponsor technology in Ripple

Each section says what the sponsor tech does, why the feature needs it, and where the proof is. "Seen" means we saw it in a file or run on 27 Oct 2026.

## Zetaris

**Integration.** The federation layer (`src/data/federation.ts`, `src/data/sources.ts`) speaks the Zetaris Lightning REST API: login, start query, page, close. It follows the published OpenAPI spec and is checked against a fake server built from that spec (`tests/zetaris-contract.test.ts`). It also runs against the local hackathon bundle (Zetaris 2.4.3). `scripts/zetaris-mount.sh` mounts the project into the bundle's containers. `scripts/zetaris-register.sh` creates database `dryrun` through the driver's `lightning-sql` CLI, with five Lightning file-store tables: `census_acs`, `pew_platform_use`, `priors_behaviour`, `biz_customers`, `upworthy_tests`. The app rewrites logical names (for example `pew.platform_use` to `dryrun.pew_platform_use`) before it sends a query. The REST API returns text, so the client turns numeric strings back into numbers.

**What the queries do.** They build the audience: ACS tables for age, gender, income and education in the ZIP, the Census x Pew join that gives the number of Instagram users the business can reach, behaviour priors, and the customer list. In the headline run (`runs/20261027-south-congress-coffe-1458`, 600 people) all 7 audience-building queries ran on Zetaris (`sampleReport.queries` in its `actions.sqlite`, each with `engine: zetaris`); the same was seen in the 20-person hosted test. Sources federated per run: Census ACS, World Bank Open Data, Pew Research Center, behaviour priors (modeled), the customer list (synthetic), and Upworthy (backtest), federated through Zetaris. World Bank is the 6th source (`worldbank.country`, tables registered as `dryrun2.*`). Tables must be re-registered on a new machine with `scripts/zetaris-register.sh` (`ZETARIS_DB=dryrun2` or a new name). The headline run 1458 predates the World Bank source and used the other sources; the UI shows them in a Data sources panel (Crowd stage) and on the New test screen.

**A bug we hit and fixed.** The Census x Pew audience join first returned 10,206 on Zetaris, because Spark read `\d` in a SQL string as `d` and every age fell into 65+. Using `[0-9]+` fixes it on both engines (commit e47d5af). The run's audience was recomputed with `scripts/fix-audience.ts` and is 27,006. The crowd sampling was unaffected. Every persona field carries the query id, and the DataAgent trace line records `engine` and `row_count`.

**What stays on DuckDB, and why.** Per-run `sim.*` tables (the action log the report agent queries) stay on in-process DuckDB, and the UI labels the engine. They are created fresh for each run, and the REST API only runs SELECT, so registering them would need the CLI step per run. A query goes to Zetaris only if every table it names is registered there. If Zetaris rejects a query, that query falls back to DuckDB and the log records why. An auth or network failure moves the rest of the process to DuckDB, so a run does not die on it.

**Why load-bearing.** The crowd is sampled from these rows, and the spend decision uses the join. Without Zetaris the same SQL runs on DuckDB and the answers match (row counts compared on the five source tables), so the product still works, but the integration is real and shown in the trace.

**Unified Semantic Layer.** USL `lightning.metastore.ripple.audience` was compiled and activated on the bundle with `COMPILE USL` / `ACTIVATE USL TABLE`. It has five entities built from the five sources, and data-quality rules registered and run with `REGISTER DQ` / `RUN DQ`. The USL and DQ statements go over JDBC (port 10000), because the REST API runs only SELECT. A USL query also runs over the app's REST client. Write-up, DDL and receipts: [docs/ZETARIS_USL.md](ZETARIS_USL.md). Reproduce: `scripts/zetaris-usl.sh` (then `npx tsx scripts/usl-handcoded-compare.ts` for the hand-coded comparison).

## Meterless Engine

Three vendored reference engines (`engines/`, upstream github.com/Meterless/Meterless, unchanged) are imported by the code:

- **H-MEM** (`src/memory/hmem.ts`). One memory per person per world, on the simulated clock. Each decision is stored; the next prompt recalls the relevant lines. In "Ask why", a person may cite only these lines, cited lines get `feedback('helpful')`, and a person asked about a post they never saw says so. This is the feature that makes the interview honest.
- **World Model** (`src/sim/world.ts`). The shared world is an append-only, content-addressed log. Twin worlds A and B are forks that replay identical base writes; `tests/fairness.test.ts` checks that the logs differ only by the post.
- **Markovian** (`src/sim/engine.ts`). One run per world, one step per round. The `[STATE_CHECKPOINT]` carryover is the world summary that goes into the next round, so prompts stay about the same size across 12 rounds.

`tests/conformance.test.ts` runs each engine's own conformance runner (`npx vitest run tests/conformance.test.ts`).

## Meterless Nightshift

**Connection.** Nightshift is the first provider in `PROVIDERS=nightshift,ollama`. The app holds no NVIDIA key: the key lives in Nightshift's Providers tab, and every hosted Nemotron call goes through Nightshift. The client calls `NIGHTSHIFT_BASE_URL` (default `http://127.0.0.1:8088/v1`), an OpenAI-compatible endpoint, with a bearer runtime token and the header `meterless-app: dryrun` (`src/llm.ts`). The token comes from `NIGHTSHIFT_TOKEN`, or from Nightshift's `proxy-token` file. A Nightshift chat call times out after 180 s; a local Ollama call after 300 s (`src/llm.ts`). On HTTP 429, 5xx, timeout or connection failure the call moves down the chain: Nightshift, then local Ollama `nemotron-3-nano:4b`. Every call logs `served_by`, tokens and time in `runs/trace.jsonl`, and the agent trace's ModelRouter line carries the same.

**Seen on 27 Oct, headline run (`runs/20261027-south-congress-coffe-1458`, 600 people, 2 seeds, 12 rounds, about 13 minutes).** `usage` in its `summary.json`: the crowd role made 394 calls and the voice role 24, all `served_by: nightshift:nvidia/nemotron-3.5-lightning-30b-a3b`. The reason role made 2 calls on an earlier direct-NVIDIA path (Super 120B, because Nightshift excludes the Super VL model, `model_excluded`); that path has since been removed from the app (no NVIDIA key in the app) and the reason role now runs on `nvidia/nemotron-3-ultra-550b-a55b` through Nightshift. Note the API reported the served model as `nemotron-3.5-super-120b-a12b`, not the `-vl-` id we asked for. Version C against A on the same 600 people (`runs/20261027-south-congress-coffe-13b7`) ran 284 crowd calls on Lightning via Nightshift. The report-review role (`nvidia/nemotron-3-ultra-550b-a55b`) made no calls in the headline run's `usage`; we saw it served through Nightshift in the 20-person hosted run (`output_examples/hosted/example_1_live.trace.jsonl`: 2 review calls). Earlier runs (`e52a`, local Nano 4B, 3.3 hours; `344c`, Version C on Lightning) are context only.

## NVIDIA Nemotron, by role

| Role | Hosted model | Where it contributes | Served by (27 Oct, headline run unless noted) |
|---|---|---|---|
| crowd, voice | `nvidia/nemotron-3.5-lightning-30b-a3b` (thinking off) | Each person's action, feeling, intent and private reason; one-line voices | Nightshift (394 crowd + 24 voice calls) |
| reason, rewriter | `nvidia/nemotron-3-ultra-550b-a55b` | Audience segments, report writer, Version C draft | Nightshift (probe on 27 Oct; the headline run's 2 reason calls predate this change and used direct NVIDIA) |
| interview | `nvidia/nemotron-3.5-lightning-30b-a3b` (thinking off) | Ask-why answers from memory lines | Nightshift (probe on 27 Oct) |
| review | `nvidia/nemotron-3-ultra-550b-a55b` | Report critic, honesty check | Nightshift (seen in the 20-person hosted run) |
| all roles, last fallback | `nemotron-3-nano:4b` via Ollama | Whole product offline | Used for the earlier 600-person run (`e52a`) and the backtest |

Model ids are in `src/config.ts` and can be overridden by `MODEL_*` and `OLLAMA_MODEL_*` variables.

## What is unique

- The agent turns the measured gap into a launch decision, with the sample-size math for a live split test as the value line. Ripple is the A/B test. The headline run (1458) ended with "Launch A: it leads by 1.4 points and is 70% likely to be the better version. A sharper Version C could widen the gap." A live split test would need 29,274 people (14,637 per version, 108% of the ZIP's 27,006 Instagram users) and paid impressions. Ripple ran it on the simulated crowd for $0 of ad spend. Version C: +1.0 pt vs A on the same crowd (30.1% vs 29.0%, run 13b7), below the 3.6-point bar, so keep A.
- Twin worlds from one hash-verified base log, so only the post differs.
- Per-person memory that interviews must cite.
- A named-agent trace with `served_by` per call, so which sponsor path answered is visible.
- Honest verdict: the verdict is code. It says "leads" with a P(better) and a CI, and "wins" only when the CI excludes zero and all seeds agree.
