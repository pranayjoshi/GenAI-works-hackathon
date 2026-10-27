# Ripple: likely judge questions

## 1. How does this fit Track 3?
Each layer is one word of the track sentence. Data: federated SQL with receipts. Knowledge: the Census x Pew audience size and labelled priors. Memory: an H-MEM per person per world. Reasoning: twin worlds, two seeds, a verdict in code. Reliable decisions: the spend decision. Actions: an approval-gated launch of two paused Meta ad sets.

## 2. Does it predict what customers will do?
No. It estimates whether two posts can be told apart on a simulated crowd, and reports the uncertainty. On our backtest no method beat chance, so we do not claim prediction.

## 3. Your backtest is at chance. Why should we trust anything?
It is at chance: 22.5 of 50 (45.0%, CI 32.1 to 58.7), on the local 4B model. Single prompts scored 24 and 25. We trust the decision because it does not rely on picking winners. It uses the measured gap, its interval and the real audience size.

## 4. Is the crowd real people's data?
No. It is 600 simulated people. Their traits are sampled from Census ACS rows and Pew rates. The customer list is synthetic.

## 5. What did the café run find?
Too close to call. A 29.6% vs B 26.7%, inside plus or minus 5.5 points. A led in both seeds, but neither seed was significant on a paired test.

## 6. Did the competitor's post cause the gap?
We don't know. A and B were tied before it in both seeds (35.3 vs 35.6, 37.2 vs 37.2) and the gap opened after. We have no run without the event, so we say when it opened, not why.

## 7. How is "don't pay for the test" calculated?
A power calculation on the simulated gap: 3,828 people per version, 7,656 in total, at 5% two-sided and 80% power. That is 28.3% of the roughly 27,006 Instagram users in 78704. Capped at 20% (2,700 per version), a test detects about 3.5 points.

## 8. Why would the agent's Version C be any better?
We don't claim it is. It was drafted from the quoted price objections and passed the honesty check. Simulating C against A on the same 600 people is one click in the UI. It ran on hosted Nemotron 3.5 Lightning through Nightshift in 11.7 minutes. C moved intent by +1.1 points (14.6% vs 13.5%), short of the 3.5-point bar, so the decision is: keep A and don't pay for a real test of C.

## 9. What stops the agent spending money?
Cancelling a pointless test and drafting a new version need no approval. Anything that spends or publishes waits for the owner. Approval creates one campaign with two ad sets (one per version, identical targeting, a fixed daily budget) and one ad each, all paused. It is not Meta's split-test study object. The code refuses any other status (`src/actions/meta.ts`). Without credentials it shows the requests and sends nothing. Live launch is optional: a live attempt in our sandbox currently fails at ad creative ("Select a Facebook Page"), so the demo shows the preview.

## 10. How do you keep simulated people from making things up?
A rule-based guard screened every decision. It fired on 731 of 4,146 (17.6%), for example withholding reasons that invented a price. Report claims must cite query ids and a critic rejects the rest. Interviews answer only from memory lines.

## 11. The simulated people share one model. Isn't that a problem?
Yes. Their views are less varied than a real crowd's. The Census-sampled traits add variety, but the underlying model is shared. We treat results as a check on whether posts differ at all, not as a market.

## 12. Where do Nemotron, Nightshift and Zetaris fit?
The 600-person demo run used local Nemotron 3 Nano 4B and DuckDB. In the 20-person hosted test, Nightshift served the crowd and voice (Nemotron 3.5 Lightning) and the report review (Nemotron 3 Ultra). Nightshift currently excludes Super VL, so the reasoning and interview role fell back to direct NVIDIA. All 7 audience-building queries in that test ran on Zetaris 2.4.3; per-run `sim.*` tables stay on DuckDB, labelled. `served_by` is logged per call. See docs/SPONSOR_TECH.md.

## 13. Intent isn't a visit. What does the metric mean?
Right. It is stated intent to visit in a simulation. Clicks are not visits either. The launch plan names the real metric and stop rules for the test worth running.

## 14. Can I reproduce it?
Yes, three ways (README quick start). Sample mode needs no credentials: it replays recorded answers when the prompt matches, and otherwise uses an offline rule-based persona model, labelled `offline-model`. `npm run smoke` replays a recorded 40-person café run with no provider. The 600-person run is kept as its saved action log, because its call recordings were damaged by concurrent writers.

## 15. What are the limits?
Agents share one model. The backtest uses 2013 to 2015 news headlines, not small-business posts. Clicks are not visits. The customer CSV is synthetic. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0).

## 16. What is pre-existing?
`engines/` is the vendored Meterless reference code (upstream commit 1742dec, 19 Oct, Apache-2.0, unchanged). The repository's initial commit is 24 Oct.
