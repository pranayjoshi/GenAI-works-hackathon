# Ripple: pitch deck outline

Track 2, "The Agent That Can Explain Why": build agents that investigate complex questions across multiple data sources, connect findings, and produce evidence-backed answers or recommendations. Also targeting Best use of NVIDIA Nemotron. Headline results come from `runs/20261027-south-congress-coffe-1458` (the copy-only run: 600 simulated people, A vs B, same product and price, hosted Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris, about 13 minutes), `runs/20261027-south-congress-coffe-13b7` (the suggested rewrite C vs A on the same audience) and `samples/backtest/2026-10-27T04-59-44-210Z.json`. Earlier runs (e52a: local Nano 4B, 3.3 hours; 344c) are context only, labelled as such. Icon: `web/icon.svg` (a drop with a ring split into A and B halves). 12 slides.

## 1. Ripple
**On slide:** Ripple simulates how the public will react to what you post, and shows you why. Open Agent Hackathon 2026, Track 2, Nemotron.
**Visual:** the icon, then the UI home with the café run.
**Notes:** A café on South Congress in Austin has two drafts of an Instagram post. Ripple builds a simulated audience from Census and Pew data, runs a day of it seeing each draft, and explains who reacted, who stayed silent, and why, with evidence. Then the agent decides whether a real paid test is worth buying.

## 2. Problem and target users
**On slide:** Anything public is posted blind: ads, social posts, announcements. You don't know how different people will react, and when something lands badly or silently you never learn why. Paid tests on a local audience are often too small to tell two posts apart. Users: owners and marketers with a ZIP-sized audience and a small budget.
**Notes:** The demo is a café, but the question (who reacts, how, and why) applies to any public-facing content. Ripple answers it with evidence before anything is posted or paid for.

## 3. Solution
**On slide:** Build the audience → Simulate → Investigate → Explain → Recommend (gated). Two counterfactual worlds, identical except for the content. The result in code ("no measurable difference" is a result). Why people reacted, in their words, each reason cited to a query or action. The agent's suggested rewrite. A spend gate. Owner approves anything that spends.
**Visual:** Result stage, Report stage, Spend gate stage.
**Notes:** It does not predict real-world sentiment. It simulates reactions, explains them with evidence, and reports uncertainty.

## 4. Agent workflow and architecture
**On slide:** input, AudienceAgent, DataAgent (Zetaris), VoiceWriter, counterfactual worlds (CrowdAgent + H-MEM + Guard), result (code), ReportWriter (SQL tools) and ReportCritic, DecisionAgent (spend gate), VersionCWriter (suggested rewrite) + HonestyCheck, owner approval, LaunchAgent (Meta, paused). ModelRouter logs the model per call.
**Visual:** the Mermaid flow in README.md; the Agents stage.
**Notes:** Three things make it an agent rather than a pipeline. It uses tools: SQL against its own run log, every claim citing a query id. It critiques and revises itself: code critic, model critic, honesty check, one revision. It has a permission model: free, reversible actions proceed; anything that spends or publishes waits for the owner. Sources it connects: Census and Pew via Zetaris, the run's event log, per-person H-MEM memory, the critics.

## 5. Technical stack
**On slide:** TypeScript, Fastify API, better-sqlite3 and DuckDB, plain-JS UI (`web/`). Models: Nemotron 3.5 Lightning, 3.5 Super VL, 3 Ultra (hosted), 3 Nano 4B (local). Meterless Nightshift, H-MEM, World Model, Markovian. Zetaris Lightning. Tests: vitest. Docker image with `POST /run`.
**Notes:** Stack is from `package.json`.

## 6. Four Nemotron models, four jobs (plus Zetaris and Meterless)
**On slide:** Lightning 30B: every simulated person's decision and voice, 394 crowd + 24 voice calls in the headline run, via Nightshift. Super 120B: reasoning (audience segments, report, interviews, the suggested rewrite), direct NVIDIA because Nightshift excludes Super VL today. Ultra 550B: the critic (report review, honesty check on the suggested rewrite), via Nightshift. Nano 4B: the whole product on a laptop, used for the earlier 600-person run and the backtest. Zetaris 2.4.3: all 7 audience-building queries of the headline run ran there. Meterless: H-MEM (per-person memory), World Model (counterfactual worlds), Markovian (round carryover).
**Visual:** the four-models table; query receipts and Nemotron panel in the UI; `served_by` in the trace.
**Notes:** Proof: `tests/zetaris-contract.test.ts`, `tests/conformance.test.ts`, `tests/fairness.test.ts`, and `usage` in `runs/20261027-south-congress-coffe-1458/summary.json`. In `runs/trace.jsonl` the headline run also has 2 `review` calls served by `nightshift:nvidia/nemotron-3-ultra-550b-a55b` (the review role, including the suggested rewrite's honesty check, which passed). Full detail in docs/SPONSOR_TECH.md.

## 7. The café run: same latte, two wordings
**On slide:** Same product, same $6.50, no discount. A (product-first): "New: Oat Milk Honey Latte, $6.50. Made with local wildflower honey. On the menu now at South Congress Coffee." B (story-first): "Slow mornings, done right. Our new Oat Milk Honey Latte is sweetened with wildflower honey from a farm 20 miles away. $6.50 on South Congress." 600 simulated Instagram users, ZIP 78704, 12 rounds, 2 seeds. A 24.8% vs B 23.4% (±5.1 points). No measurable difference. A ahead in 2 of 2 seeds.
**Visual:** Counterfactual worlds, Signals, Result stages. Label: saved run.
**Notes:** Before the competitor's "30% off all lattes" post (round 8), A led slightly: seed 1 27.6% vs 25.2%, seed 2 31.8% vs 29.6%. Intent fell in both worlds after it. We report the timing, not a cause. Customers 51.1% A vs 45.9% B (116 people); income $50-75k 18.9% A vs 28.8% B (66 people); neither is a clear segment result. 2,148 reactions to the post: 1,882 scroll-pasts, 60 written and kept private, 13 public comments.

## 8. Reliable
**On slide:** Hash-verified counterfactual worlds. Two seeds. A 95% interval. A rule-based guard flagged 199 of 3,328 decisions. Report claims cite query ids; a critic rejects the rest. Reality check (backtest): 22.5 of 50 (45.0%, CI 32.1 to 58.7), coin flip 50%.
**Visual:** Report stage with a quote linked to its action; Reality check view.
**Notes:** Be direct: no method beat chance on the 4B model, single prompts included. That is why the decision rests on measured uncertainty and abstention, not on picking winners. The audience-size query once returned 10,206 because Spark read `\d` in a SQL string as `d` and every age fell into 65+; we fixed it with `[0-9]+` (commit e47d5af) and recomputed this run's audience with `scripts/fix-audience.ts`. Audience sampling was unaffected.

## 9. Spend gate and the suggested rewrite
**On slide:** "Don't pay to A/B test these two posts." A real test needs 14,637 people per version (29,274 in all), 108% of the 27,006 Instagram users in 78704, so it cannot be run. A test at 20% of the audience (2,700 per version) detects about 3.4 points. The suggested rewrite (C): "Oat Milk Honey Latte, $6.50. Local wildflower honey. Slow mornings, done right. New on the menu at South Congress Coffee." Simulated against A on the same 600 people (run 13b7, Lightning via Nightshift): A 29.0% vs C 30.1% (±5.5), +1.0 point, short of the 3.6-point bar. Keep A, don't pay.
**Visual:** Spend gate stage.
**Notes:** Run 13b7 had no competitor event, so its A rate differs from the parent run's; the comparison is on the same audience. The decision needs the measured gap and the audience size, not a predicted winner.

## 10. Approval-gated action
**On slide:** The permission model. Cancelling the pointless test and drafting C need no approval. Anything that spends or publishes waits for the owner. Ripple renders an Instagram-style ad mockup per draft (`src/actions/creative.ts`). Approve creates one campaign with two paused ad sets (identical ZIP and age targeting, a fixed daily budget) and one ad each. It is not Meta's split-test study object. No Meta credentials: it shows the exact requests and sends nothing.
**Visual:** approval panel with the preview.
**Notes:** The code refuses any status other than paused (`src/actions/meta.ts`). Live launch is optional; our sandbox attempt currently fails at ad creative ("Select a Facebook Page").

## 11. What is unique
**On slide:** Every reason cites its evidence: query ids over the run's own log, action ids for quotes, memory lines for interviews. A spend gate from a power calculation. Counterfactual worlds from one verified base log. Memory that interviews and the focus group must cite, with an anti-repeat guard. Four data sources federated through Zetaris per run. A named-agent trace with `served_by` per call. "No measurable difference" as a normal result.
**Visual:** Why-stage answer with memory lines; the trace in a terminal.

## 12. Limits and future
**On slide:** Limits: agents share one model; the backtest uses 2013 to 2015 news headlines, not small-business posts; clicks are not visits; the customer CSV is synthetic. Future: other kinds of public content (product launches, social posts, communications), rerun the backtest on hosted Nemotron, a real-test feedback loop, small-business post data, other platforms, Meta split-test study object.
**Notes:** Say the limits aloud. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0). Vendored Meterless engines are third-party, pre-existing.
