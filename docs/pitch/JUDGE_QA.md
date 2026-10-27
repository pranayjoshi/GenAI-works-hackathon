# Ripple: likely judge questions

## 1. How does this fit Track 2, "The Agent That Can Explain Why"?
Ripple investigates across several sources and connects them into evidence-backed reasons. Sources: Census ACS and Pew rows federated through Zetaris (who is in the audience, how many people can be reached), the simulated run's own event log queried with SQL (who reacted, how, when, and who stayed silent), each person's H-MEM memory (why one person did what they did), and the critics (whether the explanation holds). Every report claim cites a query id, every quote is an action id, and interview answers cite memory lines. The loop is Build the audience, Simulate, Investigate, Explain, Recommend (gated); the recommendation is the spend gate plus an action plan that waits for the owner.

## 2. Does it predict how the public or customers will react?
No. It simulates reactions on an audience sampled from real data, explains them with evidence, and reports the uncertainty, including whether two drafts can be told apart at all. On our reality check (the Upworthy backtest) no method beat chance, so we do not claim prediction.

## 3. Your backtest is at chance. Why should we trust anything?
It is at chance: 22.5 of 50 (45.0%, CI 32.1 to 58.7), on the local 4B model. Single prompts scored 24 and 25. We trust the spend gate because it does not rely on picking winners. It uses the measured gap, its interval and the real audience size.

## 4. Is the simulated audience real people's data?
No. It is 600 simulated people. Their traits are sampled from Census ACS rows (via Census Reporter) and Pew Instagram-use rates by age. Behaviour priors are modeled and labelled. The customer list is synthetic. Four sources are federated through Zetaris per run, and the UI shows them in a Data sources panel.

## 5. What did the café run find?
Same latte, same $6.50, no discount; only the wording differs. A (product-first) 24.8% vs B (story-first) 23.4%, inside plus or minus 5.1 points: no measurable difference. A was ahead in 2 of 2 seeds. The segment splits (customers 51.1% A vs 45.9% B, 116 people; income $50-75k 18.9% A vs 28.8% B, 66 people) are not clear results. Run `20261027-south-congress-coffe-1458`. An earlier 600-person run on the local 4B model (`e52a`, 3.3 hours, a different post pair: full price vs a discount) also showed no measurable difference; it is context only.

## 6. Did the competitor's post cause the drop?
We don't know. Before the round-8 post A led slightly (seed 1: 27.6% vs 25.2%; seed 2: 31.8% vs 29.6%). Intent fell in both worlds after it. We have no run without the event for this pair, so we say when it happened, not why. (The suggested rewrite's check, run 13b7, had no event; that is why its A rate, 29.0%, differs from the parent run's 24.8%.)

## 7. How is "don't pay for the test" calculated?
A power calculation on the simulated gap: 14,637 people per version, 29,274 in total, at 5% two-sided and 80% power. There are about 27,006 Instagram users in 78704 (Census x Pew join), so that test would need 108% of them. Capped at 20% (2,700 per version), a test detects about 3.4 points.

## 8. Why would the agent's suggested rewrite (C) be any better?
We don't claim it is. Nemotron Super drafted it, and Nemotron Ultra (through Nightshift) checked that it adds no claim the originals don't make: the stored decision records `honesty: {ok: true, issues: []}` (`src/report/rewriter.ts`; the two `review` calls for run 1458 in `runs/trace.jsonl`). It reads: "Oat Milk Honey Latte, $6.50. Local wildflower honey. Slow mornings, done right. New on the menu at South Congress Coffee." We simulated it against A on the same 600 people (run `20261027-south-congress-coffe-13b7`, hosted Lightning via Nightshift): A 29.0% vs C 30.1% (±5.5), +1.0 point, short of the 3.6-point bar. So: keep A, don't pay for a real test of C.

## 9. What stops the agent spending money?
Its permission model. Cancelling a pointless test and drafting a new version are free and reversible, so they need no approval. Anything that spends or publishes waits for the owner. Approval creates one campaign with two ad sets (one per version, identical targeting, a fixed daily budget) and one ad each, all paused. It is not Meta's split-test study object. The code refuses any other status (`src/actions/meta.ts`). Without credentials it shows the requests and sends nothing. Live launch is optional: a live attempt in our sandbox currently fails at ad creative ("Select a Facebook Page"), so the demo shows the preview.

## 10. How do you keep simulated people from making things up?
A rule-based guard screened every decision. In the headline run it flagged 199 of 3,328 (for example 40 reasons that invented a price). Report claims must cite query ids; a code critic and a model critic reject the rest, with one revision allowed. Interviews answer only from memory lines, and the focus group has an anti-repeat guard so seats do not copy each other.

## 11. The simulated people share one model. Isn't that a problem?
Yes. Their views are less varied than a real audience's. The Census-sampled traits add variety, but the underlying model is shared. We treat results as a check on whether posts differ at all, not as a market.

## 12. Where do Nemotron, Nightshift and Zetaris fit?
Four models, four jobs. In the headline run, Nightshift served the simulated audience (394 calls) and voices (24 calls) on Nemotron 3.5 Lightning. Reasoning (2 calls) ran on Nemotron 3.5 Super through direct NVIDIA, because Nightshift excludes Super VL today. Nemotron 3 Ultra is the critic and honesty check; we saw it served through Nightshift in the 20-person hosted trace (`output_examples/hosted/`). Nemotron 3 Nano 4B runs the whole product locally; it ran the earlier 600-person run. All 7 audience-building queries of the headline run ran on Zetaris 2.4.3; per-run `sim.*` tables stay on DuckDB, labelled. See docs/SPONSOR_TECH.md.

## 13. Intent isn't a visit. What does the metric mean?
Right. It is stated intent to visit in a simulation. Clicks are not visits either. The action plan names the real metric and stop rules for the test worth running.

## 14. Can I reproduce it?
Yes, three ways (README quick start). Sample mode needs no credentials: it replays recorded answers when the prompt matches, and otherwise uses an offline rule-based persona model, labelled `offline-model`. `npm run smoke` replays a recorded 40-person café run with no provider. The 600-person runs are kept as their saved action logs (`runs/<id>/`).

## 15. What are the limits?
Agents share one model. The backtest uses 2013 to 2015 news headlines, not small-business posts. Clicks are not visits. The customer CSV is synthetic. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0).

## 16. What is pre-existing?
`engines/` is the vendored Meterless reference code (upstream commit 1742dec, 19 Oct, Apache-2.0, unchanged). The repository's initial commit is 24 Oct.

## 17. Did anything go wrong in the headline run?
One thing, and we fixed it. The audience-size join first returned 10,206 Instagram users on Zetaris, because Spark read `\d` in a SQL string as `d`, so every age fell into the 65+ band. We changed it to `[0-9]+` (commit e47d5af, works on both engines) and recomputed this run's audience with `scripts/fix-audience.ts`. The correct figure is 27,006. The audience sampling used other queries and was unaffected, but the "108%" and "3.4 points" figures depend on the corrected audience.

## 18. Does Ripple make the ads?
It renders an Instagram-style ad mockup and banner per draft (`src/actions/creative.ts`). The Meta launch is approval-gated: one campaign, two PAUSED ad sets, identical targeting, a fixed daily budget. In preview mode it shows the exact requests and sends nothing.
