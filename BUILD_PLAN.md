# Dry Run — Build Plan v3 (Ripple v2 × Dry Run, merged)

> Paste two versions of an ad, post or announcement. A crowd of AI people **sampled from real audience data** scrolls past, reacts, argues and remembers. Two identical crowds see A and B; you get the winner with a margin, who preferred what and why **in their own words, each quote linked to the action behind it**, a version C, and a **hit rate against real A/B tests** so you know how far to trust it. Open Nemotron models through Nightshift; data federated in Zetaris; Meterless engines for per-agent memory, shared world state and bounded context.

**Track:** 3 — Reasoning Architecture · **Target prize:** Best use of NVIDIA Nemotron
**Clock:** v3 written **26 Oct 22:20 UTC** · deadline **27 Oct 23:45 UTC** → **~25 h wall, ~20 h build**. Submit at **27 Oct 21:00 UTC**. H0 = **26 Oct 22:30 UTC**.

Previous plans: [BUILD_PLAN_v2.md](BUILD_PLAN_v2.md) (Ripple, research-revised) and the Dry Run draft (chat, 26 Oct).

---

## 0. Why v3, and what it takes from each plan

Ripple v2 is a plan you can ship in 25 hours. Dry Run is a product people would use and a validation judges would believe. v3 is **Dry Run's product and backtest on Ripple's engineering skeleton and scope discipline**.

| Area | Ripple v2 | Dry Run | v3 takes |
|---|---|---|---|
| Pitch | Any artifact (price, policy, ad); A vs auto-rewritten B | Your two drafts, A/B on twin crowds | **Dry Run**: one job, the user's own A and B; version C is the bonus |
| Personas | Copula fitted to (generated) business data; variance from data | LLM-generated in batches from a Census/Pew segment mix | **Both**: numbers drawn statistically from live Census + Pew + optional customer CSV *before* the model sees them; Lightning writes only the one-line voice |
| Crowd behaviour | Private stance + speak probability; vocal vs silent | Scroll-past counts as a response; per-channel actions | **Both**: stance + speak_p drive a fixed Instagram action schema in which scroll-past is the default |
| Comparison | A vs rewritten B, 2 seeds | Twin worlds, same seed, 3 repeats, "too close to call" | **Dry Run**: twin worlds as a forked World Model log; 2 seeds (cut to 1) |
| Memory | H-MEM = per-business memory of past runs | H-MEM = per-agent memory feeding interviews | **Dry Run**: per-agent; it is what makes interviews grounded |
| Report | Analyst + Critic loop (claims cite metrics) | Report agent with SQL tools over the action log | **Both**: tools return query ids; one Critic pass rejects any claim without one |
| Interviews | Persona drawer with receipts | One-on-one, ask-a-segment, focus group, quote→action links | **Dry Run**; focus group is P1 |
| Validation | Cracker Barrel, n = 1, scored on direction | Upworthy archive, 100 tests, vs coin flip and single prompt | **Dry Run**, cut to 50 tests. Cracker Barrel dropped: one case, and the model has read the outcome |
| Guards | Variance Guard, Report Critic, Honesty Guard (3 loops on Ultra) | none | Critic (1 pass) + Honesty check on version C; Variance Guard becomes a validity panel with no retry |
| Integration facts | Confirmed endpoints, headers, model ids, engine APIs | "queried through Zetaris", "Nemotron Nano" | **Ripple**, verbatim (§2) |
| Scope control | Hour-by-hour schedule, ordered cut list, never-cut list | 2,000 agents × 168 rounds × 6 channels × 3 repeats, no schedule | **Ripple's** discipline; Dry Run's numbers shrunk to what runs live in 3 minutes |
| Required checklist | Sample mode, traces, served_by, conformance, .env.example, ≥2 inputs | not mentioned | **Ripple** (§9, §10) |
| Demo and judges | none | 3-minute script, judge Q&A | **Dry Run**, plus Ripple's claims discipline |

**Dropped from Dry Run:** 2,000 agents and a 168-hour default (600 agents × 24 rounds gives the same ±4.4-point margin at a seventh of the cost; full week is a flag) · six channels (Instagram only; X is P2) · 3 repeat runs (2) · an Audience agent that proposes percentages (shares come from tables; the agent only names segments) · Pew as a Zetaris "query" (Pew publishes tables, not an API, so it is a labelled CSV) · ethnicity as a persona field (not sampled, nothing conditions on it) · a report "tipping agent" (the timeline tool finds the hour; naming one agent is P2).

**Dropped from Ripple:** Cracker Barrel backtest · generated POS and review tables (one optional customer CSV, generated and labelled for the demo) · Variance Guard retry loop · Scout-style intake contract · "who to tell first / owner reply script" recommender (replaced by verdict + version C) · force-graph as the main view (twin feeds are the main view; the graph is the tipping-point view).

## 1. Product and user flow

A user goes from two drafts to a winner with reasons in five steps. Running example: a coffee shop in Austin ZIP 78704 testing two Instagram posts for a new oat-milk latte.

1. **Paste the versions.** A: "New: Oat Milk Honey Latte, $6.50." B: "Your new morning ritual, 20% off this week." Text; image is P2 via Nemotron Omni.
2. **Describe the goal and audience.** "Get people within 3 miles to come in this week." The Audience agent names the segments; the shares come from Census and Pew tables (§3). The user edits the mix or uploads a customer CSV, which overrides the defaults.
3. **Pick the channel and length.** Instagram feed (only channel in v3). Default: one simulated day, 24 hourly rounds, in the ZIP's time zone. `--week` runs 168.
4. **Watch it run.** Two side-by-side feeds fill live as the twin crowds scroll past, like, comment, share and say whether they'd visit. A counter shows distinct deciders toward the 500 minimum, and a vocal-vs-silent meter shows how much of the reaction is visible.
5. **Read the verdict and ask why.** Winner with margin and how many seeds agreed, a per-segment table, the top three objections and top three likes with linked quotes, a validity panel, version C, and a chat box to interview any agent or a segment. One click runs C against the winner on the same crowd.

Mid-run, the user can inject an event at any hour ("a competitor posts 30% off on hour 14") and watch the intent line move.

## 2. Confirmed integration facts (from sources; verify at H0)

**Nightshift** — OpenAI-compatible at `http://127.0.0.1:8088/v1`. Headers: `Authorization: Bearer <runtime token>` (written to `<stateDir>/proxy-token`; placeholder `rt-local` rejected), `meterless-app: dryrun`, `meterless-scope: user`. `GET /v1/models` = status (401/403 unauthorized, 200 with `meterless/*` ids = online). Routing ids `meterless/fast|deep|auto|local|…`; provider ids used by other entries: `nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (image/audio in). Thinking toggle: `extra_body.chat_template_kwargs.enable_thinking`. 180 s timeout. Mac M1+ edition is free ("local endpoint"); whether its Providers tab routes to NVIDIA cloud is **unconfirmed** → keep the AuditWhy pattern: direct `integrate.api.nvidia.com/v1` fallback, `served_by` logged per call.

**Zetaris** — UI proxy `http://localhost:3000/api/proxy/...` with `Authorization: Bearer`, `X-Org-ID`, `X-Request-ID`; raw API on 8888 (`/api/v1.0`). One statement per request. Lightning SQL: `CREATE LIGHTNING DATABASE`, `CREATE LIGHTNING FILESTORE TABLE … FORMAT CSV`, `CREATE LIGHTNING REST TABLE … REQUEST (endpoint …)`, `CREATE SCHEMASTORE VIEW`, tables queried as `<db>.<table>`, cross-source joins in Spark SQL. Local install = bundle from zetaris.com/cloud (Docker). **Needs an account or instance — blocking question for H0.**

**Meterless engines** — `engines/hmem/reference` (vitest, zero deps; conformance: `HMEM_IMPL=… npx tsx conformance/runner.ts`, requires an exported `HMEM` class with `add/query/feedback` + services), `engines/markovian/reference` (orchestrator with injected `Generator(prompt, attachments, systemPrompt, onStream, abortSignal)`, `ChunkConfig`, carryover `COMPLETED/REMAINING/DECISIONS/CONTEXT`, markers `[STATE_CHECKPOINT]`/`[TASK_COMPLETE]`), `engines/world-model/reference` (event-sourced, `ent_`+sha256 ids, append→project). Scout Intent = spec + eval harness only → left out on purpose; forcing it in would cost points, not earn them.

**Upworthy Research Archive** — 32,487 headline tests (2013–2015) with impressions and clicks per package, CC BY 4.0, exploratory CSV downloadable from the OSF project linked in the *Scientific Data* paper. Verify the download and column names at H0 (expected: `clickability_test_id, headline, lede, eyecatcher_id, impressions, clicks, test_week, created_at`).

## 3. Crowd builder

The crowd is the people the post targets plus the people who will see it anyway. **Demographics come from data, behaviour parameters come from data or labelled priors, and nothing in the pipeline conditions behaviour on race, ethnicity or gender.** The only thing a model writes into a persona is its one-line voice, and it gets the numbers first.

### 3.1 Data sources (all registered in Zetaris; every persona carries its query ids and row refs as receipts)

| Table | Source | Kind | What it anchors |
|---|---|---|---|
| `census.acs_zip` | **live REST** `api.census.gov/data/2023/acs/acs5` for the ZCTA (B01001 age×sex, B19001 income, B19037 income×age of householder, B15003 education) | REST table | age, gender, income, education marginals; **B19037 gives the real age×income joint** |
| `pew.platform_use` | Pew Research Center *Social Media Fact Sheet* (latest), hand-entered: % of US adults using Instagram/TikTok/X/Reddit by age band and gender, and % of users on daily | CSV, labelled with source URL and year | channel membership and activity level |
| `biz.customers` | optional upload; demo = generated café loyalty list (~600 rows: age, ZIP, visits/month, avg ticket, tenure), **labelled synthetic** | CSV | overrides defaults; fits the copula when present |
| `priors.behaviour` | 24 rows by segment × income band: price sensitivity, ad skepticism (Beta a,b), susceptibility | CSV, labelled as modeled priors | behaviour parameters |
| `upworthy.tests` | Upworthy exploratory archive | CSV | backtest (§7) |
| `sim.personas_<run>`, `sim.actions_<run>` | exported per run | CSV | report queries; joined to census and personas = the federation story |

### 3.2 Segment mix

The **Audience agent** (Super, thinking on) reads the post, goal and ZIP and returns *named* segments with core/spillover roles and a channel, e.g. core = "adults 18–34 in 78704 who open Instagram daily", spillover = "all other Instagram-using adults in 78704". It never emits a percentage. Shares are computed: `share(core) = ACS share of 18–34 in ZCTA × Pew daily-Instagram rate for that band`, normalised so core lands in 50–70% and spillover 30–50% unless the user edits it. Rationale and the formula are shown in the UI.

### 3.3 Sampling (statistics own *who the people are and how much they vary*)

1. Draw (age band, gender, income band, education) per persona from `census.acs_zip`: age × income jointly from B19037, gender and education from marginals. If `biz.customers` exists, fit a Gaussian copula on its numeric columns (age, income, visits/month, ticket, tenure), sample from it, and snap demographic columns to the ZCTA marginals by rejection. A copula fitted to real rows matches or beats LLM-generated samples on distribution shape (2025–26 silicon-sampling audits, §17), which is why no model touches these fields.
2. Channel membership and activity: `P(uses Instagram | age band, gender)` and daily-use rate from `pew.platform_use`; daily minutes from a labelled prior per frequency bucket.
3. Behaviour parameters from `priors.behaviour`: price sensitivity (income band × segment), skepticism ~ Beta per segment, susceptibility (max stance move per round), speak propensity ~ Beta per segment; influence (followers) ~ log-normal long tail.
4. **Voice**: Lightning, thinking off, 25 personas per call, structured output; one line each; the prompt forbids any trait tied to race, ethnicity, gender or nationality and the schema validator rejects it. 600 personas = 24 calls.

### 3.4 Persona record (about 300 characters)

| Field | Example | Source |
|---|---|---|
| id, seed | `p_0412`, 7 | sampler |
| age, gender, ZIP, income band, education | 26, woman, 78704, $50–75k, BA | `census.acs_zip` (receipt: query id + cell) |
| channel, daily use, minutes | Instagram, daily, 90 | `pew.platform_use` + prior |
| segment, role | daily café buyer, core | Audience agent + computed share |
| price_sensitivity, skepticism, susceptibility, speak_p, activity | 0.6, 0.7, 0.3, 0.35, 0.8 | priors + channel minutes |
| influence | 340 followers | log-normal |
| voice | "Busy grad student, loves trying new spots, hates being sold to" | Lightning, batch |

Numbers drive behaviour and can be charted; the voice keeps replies human.

## 4. Simulation engine

### 4.1 World Model = the shared world

Append-only event log, projections per round. Event types: `persona_created`, `follow`, `schedule`, `round_start`, `ad_served`, `action`, `delivered` (a share or comment landing in a follower's feed), `event_injected`. Projections: per-agent feed, per-round counters, exposure set.

**Twin worlds are a fork of the log.** Base log for seed *s* = crowd + follower graph + wake schedule + serving schedule. Fork twice: world A appends `ad_served(A, …)`, world B appends `ad_served(B, …)` on the identical schedule. Same agents, same links, same hours, same RNG stream; only the ad differs. Version C later forks the same base. This is the fairness argument, and it is one function (`forkWorld(base, ad)`).

### 4.2 Markovian = one run per world, one chunk per round

Each round is a chunk. Carryover = round counters, pending deliveries, exposure set; `[STATE_CHECKPOINT]` every round so a crashed run resumes; `[TASK_COMPLETE]` at the last round. Each crowd call is persona records + H-MEM summaries + new feed items only, so call size stays flat whether the run is 24 or 168 rounds.

### 4.3 H-MEM = per-agent memory

One H-MEM instance per persona, in process (600 × 2 worlds × 2 seeds = 2,400 small instances; measured at H5, fallback = one instance per world with the agent id as a tag). On every action: `add({saw, did, felt, hour, item_id})`. Before a decision: `query` for prior exposure to the same ad and recent feed. Interviews read only from here (§6.3). `feedback` is called when an interview answer is accepted by the Critic, which is the engine's intended loop.

### 4.4 A round (24 rounds = one simulated day, ZIP time zone)

1. **Wake.** `p = activity × hourly curve` (US curve: trough at 03:00, peaks at lunch and 20:00–22:00). Local time zone, not a hardcoded routine.
2. **New feed?** An awake agent costs a model call only if its feed changed (ad served, or a followed agent shared or commented). Everyone else stays idle for free. This rule does almost all the cost saving (§11).
3. **Serve.** Paid reach spread across the day, weighted to the core segment. Guarantee: any agent not yet exposed by round 20 is served, so a 600-crowd yields ≥500 distinct deciders.
4. **Crowd call.** Lightning, thinking off, 8 agents per call, structured output. For each agent and each new item: `stance ∈ [−1, 1]`, `action`, `would_visit`, `reason` (≤ 20 words), `text` when the action is comment or share. Thinking is off because fast modes are *more* faithful for silicon sampling (§17), not only cheaper.
5. **Stance transition.** `stance_t = clamp(stance_{t−1} + susceptibility × (stance_model − stance_{t−1}))`; private stance can be negative while the public action is `scroll_past`. Vocal = comment or share; silent = everything else. The report shows both, which is the number a small business needs ("loud ≠ lost").
6. **Spread.** Comments and shares are delivered to followers next round. Followers are linked by similarity (age, ZIP, segment) with an influence-weighted long tail, so word of mouth stays mostly in-group.
7. **Memory write.** H-MEM `add` per item.

### 4.5 Action schema (Instagram; fixed from day one)

`scroll_past | like | comment | share | save | tap_through | hide`, plus `would_visit: boolean`. Zod schema, structured output, one repair retry, then default to `scroll_past` with `repaired: true` logged. Scroll-past is the most common real reaction and has to count, otherwise every post looks loved. X (`scroll_past | like | reply | repost | quote | mute`) is P2 behind the same interface.

### 4.6 Mid-run events

The user drops an event at hour *h*: text + target (all, a segment, or followers of the top-k influencers). It is appended as `event_injected` and delivered as a feed item; the timeline marks it and the segment-breakdown tool can split before/after.

## 5. A/B mode and the verdict

- **Twin worlds** per seed (§4.1). **2 seeds** by default (different wake and serving order), 1 if cut.
- **Metrics**, overall and per segment: reach (exposures incl. shares), engagement rate, mean stance, vocal share, intent (`would_visit` rate among deciders), negative actions (`hide`).
- **Margin of error.** `MOE = 1.96 × sqrt(p(1−p)/n)` over distinct deciders; at n = 500 and p = 0.5 that is ±4.4 points (±9.8 at 100). The 500-decider floor comes from this.
- **Decision rule.** A version wins on the primary metric (intent) only if it wins in every seed *and* the gap exceeds the MOE; otherwise the verdict is **"too close to call"** with the numbers shown. Agents share a model, so they are more alike than 500 people; the seeds, the validity panel and the backtest are the honest counterweights.
- **Validity panel.** Per-segment stance spread vs. the prior's expected spread, share of repaired outputs, seed agreement, served_by per model. No retry loop; it reports.
- **Verdict line.** "B wins on intent to visit, 14.2% vs 9.8% (±4.4), 2 of 2 seeds. A wins with 35–54 spillover, who found '20% off' cheap-sounding."
- **Version C.** Rewriter (Super) drafts a version aimed at the losing segments' objections; **Honesty check** (Ultra, one call) rejects a C that drops or hides the price or the offer; one click forks the same base log and runs C vs. the winner.

## 6. Report agent, interviews and focus group

### 6.1 Tools (every tool returns a `query_id`; the report may only cite numbers that came out of a tool)

| Tool | What it does |
|---|---|
| `query_actions(sql)` | SQL over `sim.actions_<run> ⋈ sim.personas_<run> ⋈ census.acs_zip` through Zetaris |
| `segment_breakdown(metric, by)` | any metric split by segment, age band, income band or hour |
| `timeline(metric)` | per-hour series, with the hours where injected events and top shares landed |
| `interview(agent_ids, question)` | asks chosen agents from their memory (§6.3) |
| `draft_variant(objections)` | writes version C |

The action log is written to SQLite during the run and exported to CSV at the end, registered in Zetaris as a filestore table, so report queries are federated joins over run data, persona receipts and live census rows.

### 6.2 Report (Super, thinking on) and Critic (Ultra, one pass)

The report agent calls tools, then writes: winner, margin, seed agreement; per-segment table; top three objections and top three likes, each with two quotes linked to action ids; the tipping hour; version C. The **Critic** receives the report and the tool log and rejects any claim without a `query_id` or whose number does not match the tool output. One revision, then ship with the Critic's residual notes shown.

### 6.3 Interviews (the feature people remember)

- **One-on-one.** Click any agent in a feed. Context = persona + H-MEM `query(question)` + its actions. Super, thinking off, in the agent's voice. **Grounding rule:** it may cite only items it saw, actions it took and its persona; asked about anything else it says it never saw it. Each quote carries the action ids it draws on, and the UI renders them as "saw post A, hour 20, scrolled past".
- **Ask a segment.** "Why did 35–54 spillover prefer A?" → sample 6 agents from that segment who reacted, interview each, Super summarises with quotes.
- **Focus group (P1).** Moderator (Super) seats 6 agents from different segments, shows both posts, runs 3 turns; each turn is one Lightning call per agent with the transcript so far. Shown live.

## 7. Reality check: the Upworthy backtest

How often does Dry Run pick the real winner of a real A/B test? This is the only good answer to "how do you know it's right?", and it is also the test of whether the crowd adds anything over a single prompt.

**Method**
1. From the exploratory split, take tests with ≥2 packages, each package ≥1,000 impressions, and a relative CTR gap between best and worst of ≥30%. Exclude tests created June 2013–January 2014 (the paper's randomisation caveat). Do not use the archive's `significance` column. Sample **50** scored tests (100 if time allows) plus a disjoint **20-test dev slice**. All prompt and parameter tuning happens on the dev slice; the scored set is run once per frozen config, and every scored run is logged, so the card can't be cherry-picked.
2. Run each best/worst pair as a two-version test on a **general US crowd** (ACS national marginals, Pew), 100 personas, 12 rounds, 1 seed, headline + lede rendered as a feed item; `tap_through` is the click.
3. Score = share of tests where the version with the higher simulated tap-through rate is the real CTR winner.

**Baselines**

| Method | What it tells us |
|---|---|
| Coin flip | 50%: the floor |
| One Super call, thinking on: "which headline gets more clicks?" | whether the crowd adds anything over a single prompt |
| One Lightning call, thinking off | same question, same model as the crowd |
| Dry Run crowd | our number |

**Reporting.** Point estimate with its 95% interval (n = 50 is about ±14 points, so we will not claim significance between crowd and single prompt unless the gap is large; we say so). The card shows all four numbers whatever they are. If the crowd shows no edge, the pitch stands on what a single prompt cannot do: segment splits, spread, memory-grounded interviews.

**What it does not prove.** These are 2013–2015 news headlines, not small-business posts; clicks are not visits; the model may have seen Upworthy headlines, and the single-prompt baselines share that advantage, so the crowd-vs-prompt gap is still a fair comparison.

**Budget.** ~2,700 crowd calls ≈ 2.5M tokens, ~15 minutes wall clock with 8 worlds in parallel (§11).

## 8. Nemotron role map

| Role | Model | Thinking | Why this one |
|---|---|---|---|
| Crowd (≈1,300 calls per A/B run), persona voices, focus-group turns | `nvidia/nemotron-3.5-lightning-30b-a3b` | off | thousands of short structured calls; fast modes are more faithful for silicon sampling and ~10× cheaper |
| Audience agent, report agent, rewriter, focus-group moderator, ask-a-segment summary | `nvidia/nemotron-3-super-120b-a12b` | on | multi-step synthesis with tool calls and carryover |
| Interviews | `nvidia/nemotron-3-super-120b-a12b` | off | few calls, needs voice quality and strict grounding |
| Report Critic, Honesty check | `nvidia/nemotron-3-ultra-550b-a55b` | on | adversarial review is the hardest job; one call each |
| Image post input (P2) | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | off | paste a poster, Omni describes it, the run proceeds |
| Single-prompt baselines | Super (on) and Lightning (off) | — | §7 |

All calls go through Nightshift with `served_by` logged; the Nemotron panel shows calls, tokens, latency and served_by per model. Deck claim: *"Dry Run runs on open models: every call can run on a DGX Spark in the back office; the demo ran on hosted Nemotron through Nightshift."*

## 9. Sponsor map (job, why it is load-bearing, evidence in the repo)

| Sponsor | Job in Dry Run | Why it is needed, not decoration | Evidence |
|---|---|---|---|
| Zetaris | One SQL layer over live Census REST, Pew CSV, customer CSV, Upworthy CSV and each run's action log; cross-source joins for personas and report queries | Persona receipts and the report's segment tables are joins across sources that live in different places | `src/data/sql/*.sql`, receipts in the persona drawer, query ids in the report |
| Meterless H-MEM | Per-agent tiered memory: what it saw, did and felt; compressed over the day | Interviews may cite only memory; without it quotes are fiction | `src/memory/hmem.ts`, conformance in `npm test`, test "interview cites only memory" |
| Meterless World Model | Shared event log: feeds, follower links, serving, injected events; twin worlds by forking the log | A crowd is shared state; a fair A/B needs an exact clone | `src/sim/world.ts`, test "twin worlds differ only by the ad event" |
| Meterless Markovian | One run per world, one chunk per round, checkpointed carryover; crowd calls stay persona + memory summary + new items | Keeps cost flat over a day or a week and resumes a crashed run | `src/sim/runner.ts`, conformance in `npm test` |
| Nightshift | Primary provider for every call; `served_by` logged | Required; routes crowd and report calls | `src/llm.ts`, Nemotron panel |
| NVIDIA Nemotron | Lightning for the crowd; Super for reasoning roles; Ultra for review; Omni P2 | Thousands of short calls need a small fast model; synthesis and review need larger ones | §8, trace |

**Required checklist.** Zetaris = all persona and report data via federated SQL (live REST + CSV, cross-source joins) · Meterless engines = H-MEM, Markovian and World Model, conformance passing in `npm test` · Nightshift = primary provider, `served_by` per call · Nemotron = 3 models in distinct roles, shown in trace and panel · sample mode = recorded runs replay offline · traces = JSONL + SQLite per step and model · ≥2 inputs (café A/B, an Upworthy pair) · `.env.example` only, no secrets in the repo.

## 10. Stack and repo layout

Node 20 + TypeScript (`tsx`), Fastify + SSE, `better-sqlite3` for the action log, traces and recordings, vendored `engines/` (Apache-2.0, unchanged), vanilla JS front end (twin feeds, charts via a pinned CDN, `force-graph` for the tipping view), no build step. Zetaris adapter records every response by SQL hash; Nightshift adapter records every completion by request hash; `SAMPLE_MODE=true` replays both so the demo and the smoke test run without network. Every run writes to a fresh `runs/<name>/` (`config.json`, `actions.sqlite`, `trace.jsonl`, `summary.json`, `run.log`); recordings for sample mode live in `samples/`.

```
dryrun/
  src/config.ts  src/llm.ts (Nightshift→NVIDIA fallback, record/replay, trace, served_by)  src/trace.ts
  src/schemas/{persona,action,report}.ts        ← the two shared contracts + report shape, agreed before code
  src/data/zetaris.ts (proxy client, record/replay)  src/data/sql/*.sql  src/data/seed/{customers,priors,pew}.ts
  src/audience/{agent,sampler,copula,voice}.ts
  src/sim/{world,fork,graph,schedule,serve,crowd,spread,runner,events}.ts
  src/memory/hmem.ts (per-agent wrapper)
  src/report/{tools,agent,critic,rewriter,honesty,interview,focus}.ts
  src/backtest/{upworthy,baselines,score}.ts
  src/api.ts
engines/hmem engines/markovian engines/world-model   (vendored reference + conformance)
web/index.html app.js style.css   samples/   tests/   scripts/smoke.sh   .env.example  README.md
```

## 11. Cost and wall-clock math (planning estimates; replace with measured numbers after the H9 checkpoint)

`calls per world ≈ agents × rounds × active_fraction / agents_per_call`, where active_fraction ≈ wake (~0.45) × feed-changed (~0.4) ≈ 0.18.

| Item | Calculation | Estimate |
|---|---|---|
| One world-day | 600 × 24 × 0.18 / 8 | ~325 calls |
| A/B run (2 versions × 2 seeds) | 4 × 325 × ~900 tokens | ~1,300 calls, **~1.2M tokens** |
| Persona voices | 24 calls | ~0.05M |
| Report, critic, rewriter, honesty, interviews | ~30 calls on Super/Ultra | ~0.2M |
| **Total per A/B test** | | **~1.5M tokens** |
| Full-week flag | 7× the crowd part | ~8.5M |
| Backtest, 50 tests | 100 worlds × 100 × 12 × 0.18 / 8 ≈ 27 calls each | ~2,700 calls, ~2.5M |

Wall clock: rounds are sequential, calls within a round run 8-wide; ~5 s per round → **~2 minutes per world, 4 worlds in parallel ≈ 3 minutes for a live A/B run**. If all 600 agents called the model every round, a world-day would be 14,400 calls; the idle rule is the saving.

## 12. Schedule (UTC)

| When | Hours | Build |
|---|---|---|
| **26 Oct 22:30–00:30** | H0–2 | **User:** install Nightshift Mac M1+, NVIDIA key in Providers, confirm `GET /v1/models` and one Lightning call with `enable_thinking: false`; get a Zetaris instance (cloud creds or local Docker bundle); download the Upworthy exploratory CSV. **Claude:** repo scaffold, `llm.ts` with fallback + record/replay + trace, zod contracts for persona and action, seed generators (customers, priors, Pew CSV). |
| 00:30–03:30 | H2–5 | Zetaris adapter + record/replay; register ACS REST table, Pew, customers, Upworthy; sampler with receipts (B19037 joint, copula when customers exist); Audience agent; voice batches. **Checkpoint: "café in 78704" → 600 personas with a believable mix and receipts.** |
| 03:30–08:00 | H5–9.5 | World Model log + fork, graph, schedule, serving, crowd batched calls with schema + repair, stance transition, spread, per-agent H-MEM, Markovian round wrapper with checkpoints, event injection, SSE per round. **Checkpoint: café A/B runs end to end on Nemotron, ≥500 deciders, twin-world test passes.** |
| 08:00–11:30 | H9.5–13 | Export actions to Zetaris; report tools; report agent; Critic pass; one-on-one interview + ask-a-segment with action links; rewriter + honesty check; version C re-run; 2 seeds + decision rule + validity panel. |
| 11:30–15:00 | H13–16.5 | UI: input → audience editor → live twin feeds + decider counter + vocal/silent meter → verdict → segment table → objections with linked quotes → interview chat → version C button → persona drawer with receipts → timeline with events → Nemotron panel. |
| 15:00–17:30 | H16.5–19 | Upworthy backtest: selection, 100-persona general crowd, both baselines, score, backtest card. Focus group (P1) if ahead. |
| 17:30–19:30 | H19–21 | Required checks: H-MEM + Markovian conformance in `npm test`; integration tests "twin worlds differ only by the ad event" and "interview cites only memory"; record samples for café A/B and one Upworthy pair; `scripts/smoke.sh` in `SAMPLE_MODE`. |
| 19:30–21:00 | H21–22.5 | README, sponsor write-up, deck, 3-minute video (backup recording of a full run first), repo public, secrets check, **submit 21:00**. |
| 21:00–23:45 | buffer | fixes only |

User sleep window: **00:30–06:30 UTC** after installs are confirmed; Claude builds H2–H8 in record mode.

## 13. Cut list (in order) and never-cut

1. Focus group → 2. Omni image input → 3. X channel → 4. seeds 2→1 → 5. backtest 50→30 tests → 6. crowd 600→300 (MOE ±5.7, say so) → 7. live ACS REST → cached CSV (label it) → 8. Critic pass → 9. World Model engine (keep the log in SQLite with the same fork semantics; keep H-MEM + Markovian).

**Never cut:** data-sampled personas with receipts · scroll-past counting as a response · twin-world fork · per-agent H-MEM interviews with action links · the Upworthy backtest with the single-prompt baseline · trace and served_by · sample mode · conformance tests · `.env.example` only.

## 14. Team split (if more than one builder)

Two shared contracts, agreed at H0 before any code: the **persona record** (§3.4) and the **action record** (`agent_id, world_id, seed, hour, item_id, action, stance, would_visit, reason, text, memory_ids`). With one builder plus Claude, the streams run in schedule order; with three people, merge streams 3 and 4.

| Stream | Owns | Done when |
|---|---|---|
| 1. Crowd and data | Zetaris tables, sampler, copula, Audience agent, voices, follower graph | "café in 78704" returns 600 personas with receipts and a believable mix |
| 2. Engine | World Model log + fork, rounds, wake and idle rule, serving, spread, H-MEM, Markovian wrapper, events | one world-day runs end to end with ≥500 deciders; twin test passes |
| 3. Report and interviews | tools, report agent, Critic, interviews, ask-a-segment, rewriter, honesty, focus group | a finished run yields a verdict with linked quotes and a working chat |
| 4. Front end and backtest | input, twin feeds, counters, charts, report page, Nemotron panel; Upworthy backtest and baselines | the demo runs without a terminal; the backtest card has real numbers |

## 15. Demo script (3 minutes, built around one moment: an agent explaining itself)

1. **0:00–0:20, the problem.** "Small businesses A/B test on real customers with real money. Most can't afford to lose either."
2. **0:20–0:50, setup.** Paste the two café posts, type "people within 3 miles of 78704", watch the audience fill from live Census and Pew rows; open one persona's receipts.
3. **0:50–1:40, the run.** Twin feeds fill live; the decider counter climbs; the vocal/silent meter shows most of the reaction is silent. At hour 14 inject "competitor posts 30% off" and watch B's intent line dip.
4. **1:40–2:15, the jaw-drop.** Click an agent who scrolled past A. Ask why. It answers from its own day, and each sentence links to the action it came from. Ask the 35–54 spillover segment why they preferred A.
5. **2:15–2:40, the verdict.** Winner, margin, 2 of 2 seeds, per-segment table, version C, one click to test it.
6. **2:40–3:00, the proof and the stack.** The backtest card (crowd vs single prompt vs chance) and one line per sponsor.

Record a backup video of a full run in `SAMPLE_MODE` before the live demo.

## 16. Judge questions and claims discipline

| Judge asks | Our answer |
|---|---|
| How do you know it's right? | The Upworthy backtest: real winner picked X% of the time vs 50% chance and Y% for a single prompt, with the interval shown. It's headlines, not small-business posts, and we say so. |
| Your agents all think alike. | They share a model, so yes, more than real people. Persona spread comes from data, not the model; seeds that disagree produce "too close to call"; the validity panel shows the spread; the single-prompt baseline measures what the crowd adds. |
| Isn't this just MiroFish? | MiroFish proved the demand. It builds agents from the document, has no comparison mode and no accuracy check. We build the crowd from the audience, run twin worlds, and measure the hit rate. We wrote our own engine (MiroFish is AGPL-3.0). |
| Aren't demographic personas stereotyping? | Demographics come from Census and Pew numbers; ethnicity is not sampled; no behaviour parameter or voice conditions on race or gender. |
| Why a crowd and not one model? | Spread, word of mouth, segment splits and memory-grounded interviews only exist in a crowd, and the backtest tests exactly this. |
| What does it cost? | About 1.5M mostly-Lightning tokens per A/B test, measured; dollar figure once Nightshift pricing is confirmed. |
| Where is the business's data? | Public Census and Pew by default, so a shop with no data can use it; a customer CSV overrides the defaults and fits the copula. The demo CSV is generated and labelled. |

✅ "Crowd sampled from live Census and Pew data, with receipts" · ✅ "Twin worlds: the only difference is the post" · ✅ "Backtested on 50 real A/B tests against chance and a single prompt; here is the number" · ✅ "Open models; runs on a DGX Spark"
❌ "Predicts customer behaviour" · ❌ "Real people's data" (the customer CSV is synthetic) · ❌ "Thousands of agents" · ❌ any backtest number we didn't run · ❌ a quote without an action link

**Build risks.** Backtest shows no edge → report it, pitch on what a prompt can't do. Live run too slow on stage → 24 rounds at 8-wide is ~3 minutes; fall back to the recorded run. Model breaks the JSON → fixed schema, structured output, repair-then-default, repaired share on the validity panel. Zetaris instance not available at H0 → adapter runs against cached CSVs with the same SQL, labelled, and the live ACS table is added when access lands. H-MEM too heavy at 2,400 instances → one instance per world, agent id as tag, same interface.

## 17. Sources

MiroFish repo and coverage · OASIS (camel-ai) · PhantomCrowd · Meterless engines + Nightshift docs (hotspot, add-provider, editions) · AuditWhy and Terms (integration patterns, model ids) · blastXbeat open-agent-hack (Zetaris API + Lightning SQL) · NVIDIA Nemotron catalog · Upworthy Research Archive (*Scientific Data*, 2021; OSF) · US Census ACS 5-year API (tables B01001, B19001, B19037, B15003) · Pew Research Center *Social Media Fact Sheet* · *Plausible but Not Valid* (2608.14606) · *Silicon Samples Match the Answers but Not the Respondents* (2610.30900) · *Conditional superiority of fast silicon sampling* (2608.14079) · *Beyond the Mean* (2606.28963) · *Think-Before-Speak* (2606.03137).
