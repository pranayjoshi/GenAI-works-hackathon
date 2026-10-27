# Ripple: pitch deck outline

Track 3, Reasoning Architecture: "turn data, knowledge, memory, and reasoning into reliable decisions and actions." Also targeting Best use of NVIDIA Nemotron. Headline results come from `runs/20261027-south-congress-coffe-1458` (the copy-only run: 600 simulated people, A vs B, same product and price, hosted Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris, about 13 minutes), `runs/20261027-south-congress-coffe-13b7` (Version C vs A on the same crowd) and `samples/backtest/2026-10-27T04-59-44-210Z.json`. Earlier runs (e52a: local Nano 4B, 3.3 hours; 344c) are context only, labelled as such. Icon: `web/icon.svg` (a drop with a ring split into A and B halves). 12 slides.

## 1. Ripple
**On slide:** Ripple. Before you pay for an A/B test, find out whether it can tell anything apart. Open Agent Hackathon 2026, Track 3, Nemotron.
**Visual:** the icon, then the UI home with the café run.
**Notes:** A café on South Congress in Austin has two Instagram posts. The usual move is to pay for a test. We test them on a simulated crowd first, then the agent decides whether the real test is worth buying.

## 2. Problem and target users
**On slide:** Small businesses (cafés, shops, studios) pay for A/B tests on ads. With a local audience, most tests are too small to tell two posts apart. Users: owners and marketers with a ZIP-sized audience and a small budget.
**Notes:** The money goes out before anyone knows whether the test could show a difference. Ripple answers that question first.

## 3. Solution
**On slide:** Two identical simulated crowds see A and B. Verdict in code, or "too close to call". Why people reacted, in their words. Version C. A spend decision. Owner approves anything that spends.
**Visual:** Verdict stage, Decision stage.
**Notes:** It does not predict customer behaviour. It rehearses, and it reports uncertainty.

## 4. Agent workflow and architecture
**On slide:** input, AudienceAgent, DataAgent (Zetaris), VoiceWriter, twin worlds (CrowdAgent + H-MEM + Guard), verdict (code), ReportWriter and ReportCritic, DecisionAgent, VersionCWriter + HonestyCheck, owner approval, LaunchAgent (Meta, paused). ModelRouter logs the model per call.
**Visual:** the Mermaid flow in README.md; the Agents stage.
**Notes:** One layer per word of the track sentence. Data: the federated SQL. Knowledge: Census x Pew audience size and labelled priors. Memory: H-MEM per person per world. Reasoning: twin worlds, two seeds, critic loop. Decisions and actions: spend decision and approval-gated launch.

## 5. Technical stack
**On slide:** TypeScript, Fastify API, better-sqlite3 and DuckDB, plain-JS UI (`web/`). Models: Nemotron 3.5 Lightning, 3.5 Super VL, 3 Ultra (hosted), 3 Nano 4B (local). Meterless Nightshift, H-MEM, World Model, Markovian. Zetaris Lightning. Tests: vitest. Docker image with `POST /run`.
**Notes:** Stack is from `package.json`.

## 6. Four Nemotron models, four jobs (plus Zetaris and Meterless)
**On slide:** Lightning 30B: every simulated person's decision and voice, 394 crowd + 24 voice calls in the headline run, via Nightshift. Super 120B: reasoning (audience segments, report, interviews, Version C draft), direct NVIDIA because Nightshift excludes Super VL today. Ultra 550B: the critic (report review, honesty check on Version C), via Nightshift. Nano 4B: the whole product on a laptop, used for the earlier 600-person run and the backtest. Zetaris 2.4.3: all 7 audience-building queries of the headline run ran there. Meterless: H-MEM (per-person memory), World Model (twin worlds), Markovian (round carryover).
**Visual:** the four-models table; query receipts and Nemotron panel in the UI; `served_by` in the trace.
**Notes:** Proof: `tests/zetaris-contract.test.ts`, `tests/conformance.test.ts`, `tests/fairness.test.ts`, and `usage` in `runs/20261027-south-congress-coffe-1458/summary.json`. In `runs/trace.jsonl` the headline run also has 2 `review` calls served by `nightshift:nvidia/nemotron-3-ultra-550b-a55b` (the Version C honesty check, which passed). Full detail in docs/SPONSOR_TECH.md.

## 7. The café run: same latte, two wordings
**On slide:** Same product, same $6.50, no discount. A (product-first): "New: Oat Milk Honey Latte, $6.50. Made with local wildflower honey. On the menu now at South Congress Coffee." B (story-first): "Slow mornings, done right. Our new Oat Milk Honey Latte is sweetened with wildflower honey from a farm 20 miles away. $6.50 on South Congress." 600 simulated Instagram users, ZIP 78704, 12 rounds, 2 seeds. A 24.8% vs B 23.4% (±5.1 points). Too close to call. A ahead in 2 of 2 seeds.
**Visual:** Twin worlds, Signals, Verdict stages. Label: saved run.
**Notes:** Before the competitor's "30% off all lattes" post (round 8), A led slightly: seed 1 27.6% vs 25.2%, seed 2 31.8% vs 29.6%. Intent fell in both worlds after it. We report the timing, not a cause. Customers 51.1% A vs 45.9% B (116 people); income $50-75k 18.9% A vs 28.8% B (66 people); neither is a clear segment result. 2,148 reactions to the post: 1,882 scroll-pasts, 60 written and kept private, 13 public comments.

## 8. Reliable
**On slide:** Hash-verified twin worlds. Two seeds. A 95% interval. A rule-based guard flagged 199 of 3,328 decisions. Report claims cite query ids; a critic rejects the rest. Backtest: 22.5 of 50 (45.0%, CI 32.1 to 58.7), coin flip 50%.
**Visual:** Report stage with a quote linked to its action; Backtest view.
**Notes:** Be direct: no method beat chance on the 4B model, single prompts included. That is why the decision rests on measured uncertainty and abstention, not on picking winners. The audience-size query once returned 10,206 because Spark read `\d` in a SQL string as `d` and every age fell into 65+; we fixed it with `[0-9]+` (commit e47d5af) and recomputed this run's audience with `scripts/fix-audience.ts`. Crowd sampling was unaffected.

## 9. Decision and Version C
**On slide:** "Don't pay to A/B test these two posts." A real test needs 14,637 people per version (29,274 in all), 108% of the 27,006 Instagram users in 78704, so it cannot be run. A test at 20% of the audience (2,700 per version) detects about 3.4 points. Version C: "Oat Milk Honey Latte, $6.50. Local wildflower honey. Slow mornings, done right. New on the menu at South Congress Coffee." Simulated against A on the same 600 people (run 13b7, Lightning via Nightshift): A 29.0% vs C 30.1% (±5.5), +1.0 point, short of the 3.6-point bar. Keep A, don't pay.
**Visual:** Decision stage.
**Notes:** Run 13b7 had no competitor event, so its A rate differs from the parent run's; the comparison is on the same crowd. The decision needs the measured gap and the audience size, not a predicted winner.

## 10. Approval-gated action
**On slide:** Cancelling the pointless test and drafting C need no approval. Anything that spends or publishes waits for the owner. Ripple renders an Instagram-style ad mockup per version (`src/actions/creative.ts`). Approve creates one campaign with two paused ad sets (identical ZIP and age targeting, a fixed daily budget) and one ad each. It is not Meta's split-test study object. No Meta credentials: it shows the exact requests and sends nothing.
**Visual:** approval panel with the preview.
**Notes:** The code refuses any status other than paused (`src/actions/meta.ts`). Live launch is optional; our sandbox attempt currently fails at ad creative ("Select a Facebook Page").

## 11. What is unique
**On slide:** A spend decision from a power calculation. Twin worlds from one verified base log. Memory that interviews and the focus group must cite, with an anti-repeat guard. Four data sources federated through Zetaris per run. A named-agent trace with `served_by` per call. "Too close to call" as a normal output.
**Visual:** Ask-why answer with memory lines; the trace in a terminal.

## 12. Limits and future
**On slide:** Limits: agents share one model; the backtest uses 2013 to 2015 news headlines, not small-business posts; clicks are not visits; the customer CSV is synthetic. Future: rerun the backtest on hosted Nemotron, a real-test feedback loop, small-business post data, other platforms, Meta split-test study object.
**Notes:** Say the limits aloud. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0). Vendored Meterless engines are third-party, pre-existing.
