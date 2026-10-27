# Ripple: pitch deck outline

Track 3, Reasoning Architecture: "turn data, knowledge, memory, and reasoning into reliable decisions and actions." Also targeting Best use of NVIDIA Nemotron. Results come from `runs/20261027-south-congress-coffe-e52a` (600 simulated people, local Nemotron 3 Nano 4B, 3.3 hours), `runs/20261027-south-congress-coffe-344c` (Version C vs A, hosted Lightning via Nightshift, 11.7 minutes) and `samples/backtest/2026-10-27T04-59-44-210Z.json`. Icon: `web/icon.svg` (a drop with a ring split into A and B halves). 12 slides.

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

## 6. How Zetaris and Meterless were used
**On slide:** Zetaris 2.4.3 local: 5 source tables in database `dryrun`; all 7 audience-building queries ran there in the hosted test; `sim.*` run tables on DuckDB (labelled). Nightshift: primary provider; served crowd, voice and review in the hosted test; Super VL excluded today, so that role fell back to direct NVIDIA. H-MEM: per-person memory. World Model: twin-world fork. Markovian: round carryover.
**Visual:** query receipts and Nemotron panel in the UI; `served_by` in the trace.
**Notes:** Each one has a test or file: `tests/zetaris-contract.test.ts`, `tests/conformance.test.ts`, `tests/fairness.test.ts`. Full detail in docs/SPONSOR_TECH.md.

## 7. The café run
**On slide:** 600 simulated Instagram users, ZIP 78704, 12 rounds, 2 seeds. A 29.6% vs B 26.7%, inside ±5.5 points. Too close to call. Tied before the competitor's "30% off" post (35.3 vs 35.6, 37.2 vs 37.2); the gap opened after it.
**Visual:** Twin worlds, Signals, Verdict stages. Label: saved run.
**Notes:** A led in both seeds, but neither seed was significant on a paired test. We describe when the gap opened, not what caused it. 874 reactions were written and kept private; only 68 became public comments on the café post.

## 8. Reliable
**On slide:** Hash-verified twin worlds. Two seeds must agree. A 95% interval. Guard fired on 731 of 4,146 decisions. Report claims cite query ids; a critic rejects the rest. Backtest: 22.5 of 50 (45.0%, CI 32.1 to 58.7), coin flip 50%.
**Visual:** Report stage with a quote linked to its action; Backtest view.
**Notes:** Be direct: no method beat chance on the 4B model, single prompts included. That is why the decision rests on measured uncertainty and abstention, not on picking winners.

## 9. Decision and Version C
**On slide:** "Don't pay to A/B test these two posts." A real test needs 3,828 people per version, 28.3% of the Instagram users in 78704. At 20% of the audience, it detects about 3.5 points. Version C was drafted from the quoted price objections and passed the honesty check. One click simulates C vs A on the same 600 people (hosted Lightning via Nightshift, 11.7 min): C 14.6% vs A 13.5%, +1.1 points, below the bar. Keep A, don't pay.
**Visual:** Decision stage.
**Notes:** The decision needs the measured gap and the audience size, not a predicted winner.

## 10. Approval-gated action
**On slide:** Cancelling the pointless test and drafting C need no approval. Anything that spends or publishes waits for the owner. Approve creates one campaign with two paused ad sets (identical ZIP and age targeting, a fixed daily budget) and one ad each. It is not Meta's split-test study object. No Meta credentials: it shows the exact requests and sends nothing.
**Visual:** approval panel with the preview.
**Notes:** The code refuses any status other than paused (`src/actions/meta.ts`). Live launch is optional; our sandbox attempt currently fails at ad creative ("Select a Facebook Page").

## 11. What is unique
**On slide:** A spend decision from a power calculation. Twin worlds from one verified base log. Memory that interviews must cite. A named-agent trace with `served_by` per call. "Too close to call" as a normal output.
**Visual:** Ask-why answer with memory lines; the trace in a terminal.

## 12. Limits and future
**On slide:** Limits: agents share one model; the backtest uses 2013 to 2015 news headlines, not small-business posts; clicks are not visits; the customer CSV is synthetic. Future: rerun the backtest on hosted Nemotron, a real-test feedback loop, small-business post data, other platforms, Meta split-test study object.
**Notes:** Say the limits aloud. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0). Vendored Meterless engines are third-party, pre-existing.
