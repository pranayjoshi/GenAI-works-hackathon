# Dry Run

**Test your post on a crowd before you spend a dollar.**

Dry Run A/B tests an ad, post or announcement on a simulated crowd of people sampled from the audience it targets. Two identical crowds see version A and version B. You watch both feeds fill live, then get the winner with a margin, who preferred which version and why in their own words, a version C, and a hit rate against real A/B tests so you know how far to trust it.

Built for the Open Agent Hackathon 2026, Track 3 (Reasoning Architecture), on NVIDIA Nemotron, Meterless engines, Nightshift and Zetaris-style federated SQL.

<!-- RESULTS -->
## Results so far (all on local Nemotron 3 Nano 4B)

Every number below came from a laptop run on Nemotron 3 Nano 4B through Ollama. No hosted model, Nightshift or Zetaris instance was available while building, so none of these numbers come from those paths. [docs/SPONSOR_SETUP.md](docs/SPONSOR_SETUP.md) shows how to turn each one on.

**Reality check: the Upworthy backtest.** We ran the crowd on 50 held-out Upworthy headline A/B tests (the scored slice). The crowd had 40 simulated people, 4 rounds and 1 seed. It picked the real winner outright 21 times and tied 3 times, a score of 22.5 of 50 with ties counted as half.

| Method | Score | Rate | 95% CI (Wilson) |
|---|---|---|---|
| Dry Run crowd | 22.5 / 50 | 45.0% | 32.1 to 58.7% |
| Single prompt, same model, thinking on | 24 / 50 | 48.0% | 34.8 to 61.5% |
| Single prompt, same model, thinking off | 25 / 50 | 50.0% | 36.6 to 63.4% |
| Coin flip | | 50.0% | |

None of the three methods can be told apart from chance on the 4B model, because every interval includes 50%. The crowd and the single prompts do not differ measurably either. An exact McNemar test with the 3 crowd ties excluded gives 10 vs 12 discordant tests, p = 0.83. Fifty tests cannot detect a difference smaller than about 15 points. The result file is [samples/backtest/2026-10-27T04-59-44-210Z.json](samples/backtest/2026-10-27T04-59-44-210Z.json).

How the tests were picked: Upworthy headline-only tests, meaning the same image and lede, where the best and worst package each had at least 1,000 impressions. The click-through gap had to be at least 30% relative, with a two-proportion z of at least 2.58 on the real clicks. Tests created between 2013-06-25 and 2014-01-10 were excluded. That leaves 982 tests, ordered by the md5 of the test id. Ranks 1 to 20 are the dev slice, used for tuning and never scored. Ranks 21 to 70 are the scored slice.

What this means: a 4B local model does not predict which headline wins, and neither does one prompt to it. Dry Run's value on this model is the parts a single prompt can't give you. You get who reacted and why, what people kept to themselves, how a competitor's post moved intent, and a version C tested on the same crowd. Each of those is tied to an action you can open. Rerunning the backtest on hosted Nemotron is one command once a key is set:

```bash
npm run backtest -- --slice scored --n 50
```

<!-- DEMO_RUN -->

## What happens in a run

1. **Paste two versions** of a post, the business, its ZIP and the goal.
2. **The Audience agent names the segments** (core and spillover). It never sets their size. Shares come from a federated join of live US Census rows and Pew Research platform-use rates.
3. **The crowd is sampled from data, not invented.** Age, gender, income and education are drawn from ACS 5-year tables for that ZIP (sex by age, householder age by income, education). Instagram use comes from Pew by age and gender. Behaviour parameters come from labelled priors. Existing-customer habits come from a Gaussian copula fitted to the customer list. Every field carries a receipt: the query id and the table cell it came from. A model writes only each person's one-line voice, after it sees the numbers, and never sees their gender.
4. **Twin worlds.** For each seed, one base world (people, follower graph, wake schedule, ad serving schedule) is built and then forked. World A and world B share an identical base log, verified by hash. The only event that differs is the post.
5. **A simulated day, round by round.** People wake on a US time-of-day curve. Only people whose feed changed cost a model call. Each call is a batch of people with their persona, their recalled memories and their new feed items. Each person picks an action (scroll past, like, comment, share, save, tap through, hide), a feeling, whether they'd visit, and a private reason. Shares land in followers' feeds next round, and comments show under the post.
6. **Loud is not lost.** Every person has a private stance and a propensity to speak. Someone may decide to comment and then keep it to themselves. The report counts vocal and silent reactions separately and shows what people "kept to themselves".
7. **Verdict in code.** A version wins only if it wins every seed and the pooled gap is larger than the 95% confidence interval. Otherwise the answer is "too close to call".
8. **Report agent with tools.** It queries the run's action log through SQL (segment breakdowns, timeline, reaction samples, crowd vs Census). Every claim must cite a query id, and every quote is an action id. A code critic rejects uncited numbers and invented prices. A model critic rejects overclaiming. One revision, then ship.
9. **Ask why.** Interview any person. They answer only from their own memory and cite the memory lines they use. Asked about something they never saw, they say so. You can also ask a whole segment or run a focus group.
10. **Version C.** A rewriter drafts a post aimed at the losing segments' objections. An honesty check rejects drafts that hide the price or offer. One click tests C against the winner on the same crowd.
11. **Reality check.** The Upworthy backtest measures how often the crowd picks the real winner of real headline A/B tests, against a coin flip and against a single prompt on the same models.

## Architecture

```
 Census Reporter REST (ACS 5-yr) ─┐
 Pew platform-use CSV ────────────┤  federated SQL (Zetaris REST client,
 behaviour priors CSV ────────────┤  local DuckDB fallback), query ids
 customer CSV (copula) ───────────┤  ──► receipts on every persona
 Upworthy archive CSV ────────────┘
                │
   Audience agent (names segments) ─► sampler + copula ─► voices (batched)
                │
   per seed: base world ─► fork ─► World A │ World B   (Meterless World Model log)
                         each round = one Markovian step (checkpointed carryover)
                         each person = own H-MEM (recall before deciding, cite in interviews)
                         crowd calls ─► Nemotron (Nightshift ─► NVIDIA ─► local Ollama)
                │
   metrics + verdict (code) ─► action log exported as sim.* tables
                │
   report agent (SQL tools) ─► code critic + model critic ─► interviews, segments, focus group, version C
```

| Piece | Where |
|---|---|
| Model client: provider chain, served_by, trace, zod validation with one repair, record/replay | `src/llm.ts` |
| Federated SQL and sources | `src/data/federation.ts`, `src/data/sources.ts`, `data/sources/` |
| Crowd builder | `src/audience/` |
| Engine: graph, schedule, twin worlds, rounds, crowd calls, metrics | `src/sim/` |
| Per-agent memory on H-MEM | `src/memory/hmem.ts` |
| Report, interviews, focus group, version C | `src/report/` |
| Upworthy backtest | `src/backtest/`, `scripts/backtest.ts` |
| UI | `web/` |
| Vendored Meterless engines (Apache-2.0, unchanged) | `engines/` |

## Sponsor tech

| Sponsor | What it does in Dry Run |
|---|---|
| **NVIDIA Nemotron** | Every model call. Hosted roles (used when `NVIDIA_API_KEY` is set; not exercised in the runs above): Nemotron 3.5 Lightning for the crowd and voices (thinking off), Nemotron 3 Super for the Audience agent, report, rewriter and interviews, Nemotron 3 Ultra for the report critic and honesty check. Local fallback: Nemotron 3 Nano 4B through Ollama, so the whole product runs offline on a laptop. |
| **Nightshift** | First provider in the chain (`http://127.0.0.1:8088/v1`, runtime token, `meterless-app` header). `served_by` is logged for every call and shown in the UI. The token is read from Nightshift's own state file, so no setup is needed once it runs. Not exercised in the runs above. |
| **Meterless H-MEM** | One memory per person per world on the simulated clock. Recalled before every decision; interviews may cite only these lines; cited lines get `feedback('helpful')`. |
| **Meterless World Model** | The shared world as an append-only, content-addressed event log. Twin worlds are forks that replay the identical base writes; the test suite proves the logs differ only by the post. |
| **Meterless Markovian** | Each world is one Markovian run with one step per round. The `[STATE_CHECKPOINT]` carryover is the world summary that goes into the next round's prompts, so prompt size stays flat. |
| **Zetaris** | The federation layer speaks the Zetaris Lightning REST API (login, open, page, close; `CREATE LIGHTNING FILESTORE TABLE`). The client follows Zetaris's published OpenAPI spec and passes a contract test against a fake server built from it. It has not yet run against a live instance. Without credentials it runs the same SQL on an in-process DuckDB, and every query records which engine answered. |

All three vendored engines pass their own conformance suites in `npm test`.

## Run it

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in whatever you have. With nothing set, Dry Run uses local Nemotron through Ollama:

```bash
ollama pull nemotron-3-nano:4b
```

```bash
npm start
```

Open http://localhost:8787 and press **Load example**.

| Command | What it does |
|---|---|
| `npm start` | API and UI on port 8787 |
| `npm run start:replay` | Same, replaying recorded model calls (no provider needed) on port 8788 |
| `npm run probe` | Checks every provider, source and the federation engine |
| `npm run run:ab -- --crowd 120 --rounds 12 --seeds 2` | A/B run from the command line |
| `npm run backtest -- --slice scored --n 50` | Upworthy backtest |
| `npm test` | Twin-world fairness, verdict rule, Meterless conformance |
| `npm run smoke` | Offline end-to-end replay with no provider |

Local Nemotron 3 Nano 4B on an M1 Pro answers about one crowd batch every 15 to 20 seconds, so local runs use 60 to 300 people. With an NVIDIA API key or Nightshift the same code runs the planned 600-person crowd.

## Data and honesty

- **Real public data:** ACS 2024 5-year tables via the Census Reporter API, Pew Research Center Social Media Fact Sheet, the Upworthy Research Archive (CC BY 4.0).
- **Labelled assumptions:** behaviour priors and Instagram minutes per day (`data/sources/priors_behaviour.csv`, every row says MODELED PRIOR or ASSUMED).
- **Synthetic:** the demo café's customer list (`data/sources/biz_customers_cafe.csv`). Upload your own to replace it.
- **Never in the prompt:** race, ethnicity, nationality or religion. Gender is a census attribute for realistic sampling. It is not shown to the voice writer, and no behaviour parameter depends on it.
- **What this is not:** a prediction of real customer behaviour. It is a structured, data-grounded rehearsal, with its accuracy measured on a public benchmark.
