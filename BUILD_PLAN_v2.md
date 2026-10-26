# Ripple — Build Plan v2 (research-revised)

> Paste a price change, policy, ad or announcement. A crowd of AI customers **grounded in the business's own data** reacts, argues and shifts. You get who turns, why, the post that tipped them, a rewritten version B, and a decision — **validated against a real backlash**, running on open Nemotron models.

**Track:** 3 — Reasoning Architecture · **Target prize:** Best use of NVIDIA Nemotron
**Clock:** plan written 26 Oct 22:00 UTC · deadline **27 Oct 23:45 UTC** → **~26 h wall, ~20 h build**. Submit at **27 Oct 21:00 UTC**.

---

## 0. What changed since v1 and why

| v1 assumption | What research showed | Change |
|---|---|---|
| ~40 h left | **26 h** | Scope cut ~40%; ordered cut list in §9 |
| "Thousands of agents react live" | MiroFish (82k★, OASIS-based) already does exactly this: seed text → GraphRAG → Twitter+Reddit sim → narrative report. No validation, no business data, AGPL, costly. PhantomCrowd does the marketing version. | Don't compete on crowd size or narrative. Compete on **grounding, validity and action** — the three things neither has. |
| Personas from an LLM prompt | 2025–26 audits: LLM "silicon samples" are **over-coherent, low-variance, homogeneous**; a plain **Gaussian copula fitted to real data matches or beats every LLM** on distributions; prompt debiasing doesn't fix it; persona conditioning helps (+0.18); **fast (no-reasoning) modes beat slow ones** | **Copula-anchored crowd** (§3): statistics own *who the people are and how much they vary*; Nemotron owns *what they do and say*. Crowd runs on Lightning with thinking OFF — research-backed, not a cost hack. |
| Agents post publicly each round | Think-Before-Speak (2026): realism needs **private stance ≠ public expression**; willingness to speak depends on perceived opinion climate | Each agent keeps a private stance and a speak-probability. Output reports **vocal vs silent** reaction — the number a small business actually needs ("loud ≠ lost"). |
| Python + custom engines | Meterless engines are **TypeScript reference implementations (Apache-2.0) with conformance suites**; Terms/AuditWhy vendor them unchanged | **TypeScript end-to-end.** Engines run in-process; their conformance runners are the required "passing test" for free. |
| Unity backtest | Cracker Barrel logo (19→26 Aug 2025): reverted in 7 days, traffic −8%, core older/traditional loyalists most negative, political amplification — a *brand change that alienated regulars* is the small-business story exactly | Backtest = Cracker Barrel. Unity dropped. |

## 1. Positioning (one paragraph for the deck)

MiroFish-style crowds predict from a text seed and hand you a story. Ripple builds the crowd from the business's own POS, loyalty and review data plus live census data federated in Zetaris, samples personas from a copula so the crowd keeps real-world variance, lets Nemotron agents act and argue with private stances, checks itself against a variance guard and a documented real backlash, and ends with a decision: ship A, ship the honestly-rewritten B, who to tell first, and what to say when the first complaint lands.

## 2. Confirmed integration facts (from sources, verify at H0)

**Nightshift** — OpenAI-compatible at `http://127.0.0.1:8088/v1`. Headers: `Authorization: Bearer <runtime token>` (written to `<stateDir>/proxy-token`; placeholder `rt-local` rejected), `meterless-app: ripple`, `meterless-scope: user`. `GET /v1/models` = status (401/403 unauthorized, 200 with `meterless/*` ids = online). Routing ids `meterless/fast|deep|auto|local|…`; provider ids used by other entries: `nvidia/nemotron-3.5-lightning-30b-a3b`, `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3-ultra-550b-a55b`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (image/audio in). Thinking toggle: `extra_body.chat_template_kwargs.enable_thinking`. 180 s timeout. Mac M1+ edition is free ("local endpoint"); whether its Providers tab routes to NVIDIA cloud is **unconfirmed** → keep AuditWhy's pattern: direct `integrate.api.nvidia.com/v1` fallback, `served_by` logged per call.

**Zetaris** — UI proxy `http://localhost:3000/api/proxy/...` with `Authorization: Bearer`, `X-Org-ID`, `X-Request-ID`; raw API on 8888 (`/api/v1.0`). One statement per request. Lightning SQL: `CREATE LIGHTNING DATABASE`, `CREATE LIGHTNING FILESTORE TABLE … FORMAT CSV`, `CREATE LIGHTNING REST TABLE … REQUEST (endpoint …)`, `CREATE SCHEMASTORE VIEW`, tables queried as `<db>.<table>`, cross-source joins in Spark SQL. Local install = bundle from zetaris.com/cloud (Docker). **Needs an account/instance — blocking question.**

**Meterless engines** — `engines/hmem/reference` (vitest, zero deps; conformance: `HMEM_IMPL=… npx tsx conformance/runner.ts`, requires an exported `HMEM` class with `add/query/feedback` + services), `engines/markovian/reference` (orchestrator with injected `Generator(prompt, attachments, systemPrompt, onStream, abortSignal)`, `ChunkConfig`, carryover `COMPLETED/REMAINING/DECISIONS/CONTEXT`, markers `[STATE_CHECKPOINT]`/`[TASK_COMPLETE]`), `engines/world-model/reference` (event-sourced, `ent_`+sha256 ids, append→project), Scout Intent = spec + eval harness only.

## 3. The model (what's new)

```
Zetaris (federated)                    Copula-anchored Audience Builder
 census.acs_zip  (live REST → api.census.gov)   ┐
 biz.pos_transactions (CSV)                      │ segment → fit Gaussian copula on
 biz.loyalty_members (CSV, other ID format)      ├─► (freq, ticket, tenure, rating,
 biz.reviews (CSV)                               │   age, income) → sample N personas
 priors.price_sensitivity (CSV, labelled priors) ┘   with receipts (rows + query ids)
                                                              │
                 ┌────────────────────────────────────────────▼──────────────┐
                 │ SIMULATION — one Markovian run, one chunk per round        │
                 │  World Model: append-only feed events, projections/round   │
                 │  Crowd (Lightning, thinking OFF, 8 personas/call):         │
                 │    private_stance ∈ [-1,1], speak_p, action, text          │
                 │  Markov stance transitions bounded by persona susceptibility│
                 │  Variance Guard: crowd variance / joint coverage vs copula │
                 │    baseline → re-run collapsed segments (max 1 retry)      │
                 │  H-MEM: per-business memory of past runs (recall → seeds)  │
                 └────────────────────────────────────────────┬──────────────┘
                                                              │
 Analyst (Super, thinking ON) ──► Report Critic (Ultra): every claim cites a metric; reject → revise (≤2)
      │
 Rewriter (Super) ──► Honesty Guard (Ultra): rejects rewrites that hide the change → re-sim variant B
      │
 Recommender: ship A/B · vocal vs silent · who to tell first · owner reply script
```

**Agent roles (7, interdependent):** Intake (Scout Intent-style sense→interpret→guard→route, signed contract) → Audience Builder → Crowd ↔ Variance Guard → Analyst ↔ Report Critic → Rewriter ↔ Honesty Guard → Recommender. Loops: 3. Branching: artifact type changes templates; guard verdicts change the path; H-MEM recall changes the plan.

**Outputs:** faction map + timeline with tipping round and patient-zero post · segment table (stance, vocal %, silent %, weight) · evidence-cited report · variant B with diff · A vs B with 2-seed bands · validity panel (variance ratio vs baseline, guard retries) · backtest card · Nemotron panel (calls, latency, tokens, served_by per model).

## 4. Nemotron role map

| Role | Model | Thinking | Why this one |
|---|---|---|---|
| Crowd (≈150 calls/run) | `nvidia/nemotron-3.5-lightning-30b-a3b` | off | fast modes are *more* faithful (2026 silicon-sampling result) and 10× cheaper |
| Intake, Analyst, Rewriter | `nvidia/nemotron-3-super-120b-a12b` | on | multi-step synthesis with carryover |
| Report Critic, Honesty Guard | `nvidia/nemotron-3-ultra-550b-a55b` | on | adversarial review is the hardest job |
| Image ad input (P2) | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | off | paste a poster, Omni describes it, sim runs |

Deck claim: *"Ripple runs on open models: every call can run on a DGX Spark in the back office; the demo ran on hosted Nemotron through Nightshift."*

## 5. Stack

Node 20 + TypeScript (`tsx`), Fastify + SSE, `better-sqlite3` for traces/recordings, vendored `engines/` (Apache-2.0, unchanged), vanilla JS + `force-graph` (pinned CDN) front end, no build step. Zetaris adapter records every response by SQL hash → sample mode replays. Nightshift adapter records every completion by request hash → sample mode replays. One `SAMPLE_MODE=true` flag.

```
ripple/
  src/config.ts  src/llm.ts (Nightshift→NVIDIA fallback, record/replay, trace)  src/trace.ts
  src/data/zetaris.ts (proxy client, record/replay)  src/data/seed/*.ts (generators)  src/data/sql/*.sql
  src/audience/{segments,copula,builder}.ts   src/sim/{graph,world,crowd,guard,runner}.ts
  src/agents/{intake,analyst,critic,rewriter,honesty,recommender}.ts
  src/memory/hmem.ts (wrapper)  src/backtest/crackerbarrel.ts  src/api.ts
engines/hmem engines/markovian engines/world-model   (vendored reference + conformance)
web/index.html app.js style.css   samples/   tests/   scripts/smoke.sh   .env.example  README.md
```

## 6. Data (loaded into Zetaris at H3)

| Table | Rows | Source | Federation role |
|---|---|---|---|
| `census.acs_zip` | 1 ZIP | **live REST** to `api.census.gov/data/2023/acs/acs5` (age, income, households) | real demographic anchor |
| `biz.pos_transactions` | ~20k | generated, 12 months, `cust_id` like `C-00412` | frequency, ticket |
| `biz.loyalty_members` | ~800 | generated, `member_no` like `LM00412` (**different key format**) | tenure, channel opt-in; ID resolution = real federation work |
| `biz.reviews` | ~300 | generated with Lightning from personas | rating, voice |
| `priors.price_sensitivity` | 20 | labelled priors by age×income band (documented as modeled) | elasticity prior |

Backtest audience: ACS demographics for TN/GA/KY core markets + published customer profile (older, Southern, long-tenure, nostalgia-driven). Labelled as modeled, scored on direction, most-negative segment, top objections, tipping within 2 rounds, and whether the Recommender says "revert/soften" (what the company did on day 7).

## 7. Schedule (UTC)

| When | Hours | Build |
|---|---|---|
| **26 Oct 22:00–00:00** | H0–2 | **User:** install Nightshift Mac M1+, NVIDIA key in Providers, confirm `GET /v1/models` + one Lightning call; get Zetaris instance (cloud creds or start local Docker bundle). **Claude:** repo scaffold, `llm.ts` with Nightshift→NVIDIA fallback + trace, data generators. |
| 00:00–03:00 | H2–5 | Zetaris adapter + record/replay; load 5 sources; ACS REST table; federated persona query with receipts. Copula fit + sampling. |
| 03:00–07:00 | H5–9 | Social graph, World Model feed, Crowd batched calls, Markov stance transitions, Markovian run wrapper, Variance Guard + retry, SSE per round. **Checkpoint: café run end-to-end on Nemotron.** |
| 07:00–11:00 | H9–13 | Analyst, Report Critic loop, Rewriter + Honesty Guard, variant B re-sim, Recommender, 2 seeds, H-MEM recall + feedback. |
| 11:00–14:00 | H13–16 | UI: input → live graph → timeline/tipping → report → A/B bands → validity panel → persona drawer with receipts → Nemotron panel. |
| 14:00–16:00 | H16–18 | Cracker Barrel backtest + card. Scout-style intake contract (P1). |
| 16:00–18:00 | H18–20 | Required checks: H-MEM + Markovian conformance in `npm test`; integration test "H-MEM recall changes the rewrite"; record samples; `scripts/smoke.sh` in `SAMPLE_MODE`. |
| 18:00–21:00 | H20–23 | README, sponsor write-up, deck, 3-min video, repo public, secrets check, **submit**. |
| 21:00–23:45 | buffer | fixes only |

User sleep window suggestion: **00:00–06:00 UTC** after installs are confirmed; Claude builds H2–H9 in record mode.

## 8. Required-checklist mapping

Zetaris = all persona data via federated SQL (5 sources, live REST + CSV, cross-key join) · Meterless Engines = Markovian (sim run), H-MEM (cross-run memory), World Model (feed), each with conformance passing · Nightshift = primary provider, `served_by` logged · Nemotron = 3 models in distinct roles, shown in trace + panel · sample mode = recorded runs · traces = JSONL + SQLite per step/model · ≥2 inputs (café A/B, Cracker Barrel) · `.env.example` only.

## 9. Cut list (in order)

1. Omni image-ad input → 2. Scout contract (keep plain intake) → 3. World Model engine (keep H-MEM + Markovian) → 4. seeds 2→1 → 5. personas 200→100 → 6. Report Critic loops 2→1 → 7. live ACS REST → cached CSV (label it).
**Never cut:** copula audience + receipts, Variance Guard, private/vocal split, backtest, honest rewriter, trace/served_by, sample mode, conformance tests.

## 10. Claims discipline

✅ "Crowd sampled from a copula fitted to the business's data, so variance matches the data, not the model" · ✅ "Backtested on a documented 2025 backlash; here is what it got right and wrong" · ✅ "Open models; runs on a DGX Spark"
❌ "Predicts customer behaviour" · ❌ "Real people's data" · ❌ "Thousands of agents" · ❌ any backtest number we didn't run

## 11. Sources

MiroFish repo and coverage · OASIS (camel-ai) · PhantomCrowd · Meterless engines + Nightshift docs (hotspot, add-provider, editions) · AuditWhy and Terms (integration patterns, model ids) · blastXbeat open-agent-hack (Zetaris API + Lightning SQL) · NVIDIA Nemotron catalog · *Plausible but Not Valid* (2608.14606) · *Silicon Samples Match the Answers but Not the Respondents* (2610.30900) · *Conditional superiority of fast silicon sampling* (2608.14079) · *Beyond the Mean* (2606.28963) · *Think-Before-Speak* (2606.03137) · CNN / Fox Business / Forbes on Cracker Barrel, Aug–Sep 2025.
