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
**The demo run: South Congress Coffee, 600 people.** The run is saved in [runs/20261027-south-congress-coffe-e52a](runs/20261027-south-congress-coffe-e52a) and opens in the UI.

- **The crowd.** 600 simulated Instagram users in ZIP 78704, drawn from ACS 2024 5-year Census rows and national Pew Instagram usage rates. The core group, aged 25 to 34, is deliberately oversampled to 50%. About a fifth carry habits from a synthetic customer list.
- **The day.** One simulated day in 12 two-hour rounds, 07:00 to 07:00, run twice (2 seeds, same people). Each seed has twin worlds that start from a base log verified identical by hash. Only the post differs.
- **The verdict: too close to call.** Intent to visit was 29.6% for A and 26.7% for B, a 2.9-point gap inside a ±5.5-point 95% interval. A was ahead in both seeds, but neither seed was significant on a paired test, and the two versions were tied until the competitor's post. We report no measurable difference between the two posts.
- **The competitor's post.** "30% off all lattes" was injected at round 8 of 12 into both worlds. Before it, A and B were tied in both seeds: 35.3% vs 35.6%, and 37.2% vs 37.2%. After it, stated intent fell in all four worlds, including among people who had already decided. A finished ahead of B (31.8% vs 28.0% in seed 1, 27.4% vs 25.4% in seed 2). That gap is not statistically distinguishable, it was concentrated in people who first saw the post at or after the competitor's post, and an interrupted earlier attempt gave a different split. We have no run without the competitor event, so we describe when the gap opened, not what caused it.
- **Loud is not lost.** Across the four worlds, 874 reactions were written but kept private. The simulated person drafted a reply, and their modelled propensity to speak decided not to post it; that propensity is a labelled prior, not a measurement. 439 of those were reactions to the café's post and 435 to the competitor's. Only 68 reactions to the café's post became public comments, plus 83 under the competitor news. No one shared either post in this run.
- **The guard.** A rule-based fact-and-coherence guard screened every decision before it was logged. It fired on 731 of 4,146 (17.6%). Most often it forced a positive action paired with a negative feeling to scroll-past (245), cancelled a would-visit from someone who strongly disliked the post (204), and withheld reasons that claimed the person had seen the post before (123, plus 71 in comments) or invented a price (87, plus 22).
- **Quality checks.** There were 4,146 simulated reactions across four worlds: 2,088 to the café post and 2,058 to the competitor's. 0.9% came from model output that needed a repair or a default. 97.8% of the non-empty private reasons are distinct strings, and 70% of reactions were scroll-past.
- **The decision.** "Don't pay to A/B test these two posts: they are too close to tell apart with the people South Congress Coffee can reach. Test a bolder version instead." Detecting a 2.9-point gap needs about 3,828 people per version, 7,656 in all, at 5% significance and 80% power. That is 28.3% of the roughly 27,006 Instagram users in 78704. A test capped at 20% of the local audience, 2,700 per version, can only detect a gap of about 3.5 points. The agent cancelled the A vs B test on its own and drafted version C from the price objections, and the draft passed the honesty check. A real test of A vs C waits for the owner's approval. This decision does not rely on the crowd predicting a winner: it uses the measured uncertainty and the real audience size. See [launch_plan.json](runs/20261027-south-congress-coffe-e52a/launch_plan.json).
- **Compute.** The whole run used Nemotron 3 Nano 4B locally through Ollama on an M1 Pro laptop: 602 crowd calls with 0.99M input tokens, or 640 calls and 1.12M input tokens including voices, report and review. The one segment-naming call was replayed from a response the same model recorded earlier. The run took 3.3 hours, and the video shows the saved run, not a live one.

**The decision and its own check.** The demo run ends with "Don't pay to A/B test these two posts". A real test would need 3,828 people per version, 28.3% of the roughly 27,006 Instagram users in 78704, to detect a 2.9-point gap. A test capped at 20% of that audience detects about 3.5 points. The agent drafted Version C from the quoted price objections, and it passed the honesty check. The agent then simulated C against A on the same 600 people, on hosted Nemotron 3.5 Lightning through Nightshift, in 11.7 minutes ([runs/20261027-south-congress-coffe-344c](runs/20261027-south-congress-coffe-344c)). C moved intent by +1.1 points (14.6% vs 13.5%), short of the bar, so the decision is to keep A and not pay for a real test of C. The Meta launch stays available behind the owner's approval, marked not recommended. Only that C run used hosted models; the numbers above are from the local 4B model.

**Offline replay.** `npm run smoke` replays a recorded 40-person café run with no model provider and checks that it reproduces the same verdict. The 600-person run's per-call recordings were damaged by concurrent writers to the shared recordings file, so that run is kept as its saved action log rather than as a call-by-call replay.

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
11. **The decision and the action.** The run ends with a spend decision, not just a verdict. A power calculation on the simulated gap, against the number of Instagram users the business can actually reach (Census × Pew join), answers one question: is a real A/B test of these posts worth paying for? If not, the agent cancels it and drafts a bolder version from the quoted objections, with an honesty check. It then writes a launch plan for the test that is worth running: variants, targeting, people per version, the success metric, and the decision and stop rules. Free, reversible steps run on their own: cancelling the pointless test, drafting the new version, and simulating it against the leader on the same crowd. The agent then checks the result against its own bar, the smallest gap an affordable real test could detect, and updates the decision. Anything that spends money or publishes waits for the owner's approval. Approving creates the real split test in Meta Ads through the Marketing API: one campaign, one ad set per version with identical ZIP and age targeting and budget, and one ad each, all created paused. The code refuses any other status. With a sandbox ad account nothing can spend, and without Meta credentials Dry Run shows the exact requests and sends nothing ([docs/META_SETUP.md](docs/META_SETUP.md)).
12. **Reality check.** The Upworthy backtest measures how often the crowd picks the real winner of real headline A/B tests, against a coin flip and against a single prompt on the same models.

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
| Report, interviews, focus group, version C, spend decision and launch plan | `src/report/` |
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
| `npm run smoke` | Type-check, tests, then an offline replay of a recorded café run with no model provider |

Local Nemotron 3 Nano 4B on an M1 Pro answers about one crowd batch every 15 to 20 seconds. A 600-person, 12-round, 2-seed run takes about 3.3 hours locally. With an NVIDIA API key or Nightshift the same code runs in parallel against hosted Nemotron.

## Data and honesty

- **Real public data:** ACS 2024 5-year tables via the Census Reporter API, Pew Research Center Social Media Fact Sheet, the Upworthy Research Archive (CC BY 4.0).
- **Labelled assumptions:** behaviour priors and Instagram minutes per day (`data/sources/priors_behaviour.csv`, every row says MODELED PRIOR or ASSUMED).
- **Synthetic:** the demo café's customer list (`data/sources/biz_customers_cafe.csv`). Upload your own to replace it.
- **Never in the prompt:** race, ethnicity, nationality or religion. Gender is a census attribute for realistic sampling. It is not shown to the voice writer, and no behaviour parameter depends on it.
- **What this is not:** a prediction of real customer behaviour. It is a structured, data-grounded rehearsal, with its accuracy measured on a public benchmark.
