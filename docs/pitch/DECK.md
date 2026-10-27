# Ripple: pitch deck outline

Track 2, The Agent That Can Explain Why. Also targeting Best use of NVIDIA Nemotron. Headline results come from `runs/20261027-south-congress-coffe-1458` (the copy-only run: 600 simulated people, 2 drafts, same product and price, hosted Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris, about 13 minutes), `runs/20261027-south-congress-coffe-13b7` (Version C vs A on the same crowd) and `samples/backtest/2026-10-27T04-59-44-210Z.json`. Earlier runs (e52a: local Nano 4B, 3.3 hours; 344c) are context only, labelled as such. 13 slides, covering the eight points the submission requires: problem and users, solution, workflow, stack, how Zetaris and Meterless were used, what was unique, product visuals and future enhancements.

## 1. Ripple
**On slide:** "Ripple simulates how the public will react to what you post, and shows you why." Open Agent Hackathon 2026, Track 2, The Agent That Can Explain Why.
**Notes:** Works for any public-facing content: ads, social posts, tweets, LinkedIn comments, announcements, product copy, statements. You give it one or more drafts.

## 2. Problem and target users
**On slide:** An ad, a tweet or an announcement is public the moment you publish it. Testing it on real people costs money and time, and a bad reaction can't be taken back. Users: marketers, founders, comms teams and creators who publish to a public audience.
**Notes:** They need to know who will respond, who will stay silent, how each group will feel, and why, before they post.

## 3. The solution
**On slide:** Build an audience from real Census and Pew data. Simulate a day of it seeing the post. Report who responded, who stayed silent and how each group felt. Cite the evidence behind every reason. Given two drafts, say which wins and why.
**Visual:** the Twin worlds stage.
**Notes:** It rehearses; it does not predict. The A/B comparison is the method for a fair measurement, not the identity of the product.

## 4. Agent workflow
**On slide:** The parallel-agents diagram: build the audience, simulate both worlds at once, investigate and explain, recommend (gated).
**Notes:** Build the audience, Simulate, Investigate, Explain, Recommend (gated). ModelRouter logs the model per call.

## 5. Why it's an agent, not a pipeline
**On slide:** It uses tools (SQL against its own run log and the Census and Pew data, citing the query behind every number). It critiques and revises itself (code critic, Nemotron Ultra critic, honesty check). It has a permission model (spending and publishing wait for the owner; ads are created paused).
**Notes:** Visible in every trace: named agents, handoffs, `request_revision`, SQL queries, the model behind each call.

## 6. Technical stack
**On slide:** TypeScript, Fastify, `POST /run`, Docker. Zetaris Lightning 2.4.3 with DuckDB fallback. Meterless Nightshift, H-MEM, World Model, Markovian. Nemotron 3.5 Lightning and 3 Ultra through Nightshift. Plain-JS UI. vitest.

## 7. How Zetaris was used
**On slide:** Five sources as Lightning tables; every persona field carries its query id; one Census x Pew join sizes the audience; the Unified Semantic Layer `ripple.audience`.
**Visual:** the Data sources panel.
**Notes:** All 7 audience-building queries of the headline run ran on Zetaris. Per-run sim tables stay on DuckDB, labelled. See `docs/ZETARIS_USL.md`.

## 8. How Meterless was used
**On slide:** Nightshift is the primary AI provider. H-MEM: per-person memory that interviews must cite. World Model: twin worlds forked from one hash-verified log. Markovian: one checkpointed step per round.
**Notes:** Tests: `tests/conformance.test.ts`, `tests/fairness.test.ts`.

## 9. Where NVIDIA contributes
**On slide:** Lightning 30B: crowd decisions, voices, interviews. Ultra 550B: reasoning, report, critic, honesty check. All through Nightshift, with `served_by` logged per call.

## 10. Example run
**On slide:** Two drafts for one café, 600 people, 2 seeds: A 24.8% vs B 23.4% (+1.4 points, interval ±5.1), A ahead in both seeds. 3,328 decisions; the Guard fired on 199.
**Notes:** We describe the lead, not a cause.

## 11. Evidence and checks
**On slide:** 3 critics; 2 seeds on hash-verified identical audiences; the backtest of 50 real Upworthy headline tests, 22.5 right, no method beat chance.
**Notes:** The backtest ran on the local 4B model; no accuracy claim.

## 12. Recommend, gated
**On slide:** "Launch A: it leads by 1.4 points and is 70% likely to be the better version." A live split test needs 29,274 people, 108% of the 27,006 Instagram users in 78704. Version C: +1.0 point, below the 3.6-point bar. Spending waits for the owner.

## 13. What was unique, and what's next
**On slide:** Every claim cites its query; twin worlds from one verified log; H-MEM memory interviews must cite; a permission model; a named-agent trace with the model on every call; a leader with a probability, never a made-up winner. Next: rerun the backtest on hosted Nemotron, feed real test results back into the crowd, validate on real post data, move the app onto the Zetaris USL.
**Visual:** Ask why focus group.
**Notes:** Limits, said aloud: the simulated people share one model family; the backtest uses 2013 to 2015 headlines; clicks and stated intent are not visits; the customer list is synthetic. Data: Census ACS, Pew Research Center, World Bank, Upworthy Research Archive (CC BY 4.0). Vendored Meterless engines are third-party and pre-existing.
