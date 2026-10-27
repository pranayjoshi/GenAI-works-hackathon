# Ripple: likely judge questions

## 1. How does this fit Track 3?
Each layer is one word of the track sentence. Data: federated SQL with receipts. Knowledge: the Census x Pew audience size and labelled priors. Memory: an H-MEM per person per world. Reasoning: twin worlds, two seeds, a verdict in code. Reliable decisions: the spend decision. Actions: an approval-gated launch of two paused Meta ad sets.

## 2. Does it predict what customers will do?
No. It estimates whether two posts can be told apart on a simulated crowd, and reports the uncertainty. On our backtest no method beat chance, so we do not claim prediction.

## 3. Your backtest is at chance. Why should we trust anything?
It is at chance: 22.5 of 50 (45.0%, CI 32.1 to 58.7), on the local 4B model. Single prompts scored 24 and 25. We trust the decision because it does not rely on picking winners. It uses the measured gap, its interval and the real audience size.

## 4. Is the crowd real people's data?
No. It is 600 simulated people. Their traits are sampled from Census ACS rows (via Census Reporter) and Pew Instagram-use rates by age. Behaviour priors are modeled and labelled. The customer list is synthetic. Four sources are federated through Zetaris per run, and the UI shows them in a Data sources panel.

## 5. What did the café run find?
Same latte, same $6.50, no discount; only the wording differs. A (product-first) 24.8% vs B (story-first) 23.4%, a +1.4-point lead with a 95% CI of −3.7 to +6.5, so Ripple says "A leads", not "A wins". A was ahead in 2 of 2 seeds and is 70% likely to be the better version. The segment splits (customers 51.1% A vs 45.9% B, 116 people; income $50-75k 18.9% A vs 28.8% B, 66 people) are not clear results. Run `20261027-south-congress-coffe-1458`. An earlier 600-person run on the local 4B model (`e52a`, 3.3 hours, a different post pair: full price vs a discount) is context only and predates the leader/winner verdict.

## 6. Did the competitor's post cause the drop?
We don't know. Before the round-8 post A led slightly (seed 1: 27.6% vs 25.2%; seed 2: 31.8% vs 29.6%). Intent fell in both worlds after it. We have no run without the event for this pair, so we say when it happened, not why. (Version C's check, run 13b7, had no event; that is why its A rate, 29.0%, differs from the parent run's 24.8%.)

## 7. How is the live-test sample size calculated?
A power calculation on the simulated gap: 14,637 people per version, 29,274 in total, at 5% two-sided and 80% power. There are about 27,006 Instagram users in 78704 (Census x Pew join), so a live split test would need 108% of them and paid impressions. Ripple ran the test on the simulated crowd for $0 of ad spend, so the decision is: Launch A: it leads by 1.4 points and is 70% likely to be the better version. A sharper Version C could widen the gap. Capped at 20% (2,700 per version), a test detects about 3.4 points.

## 8. Why would the agent's Version C be any better?
We don't claim it is. Nemotron Super drafted it, and Nemotron Ultra (through Nightshift) checked that it adds no claim the originals don't make: the stored decision records `honesty: {ok: true, issues: []}` (`src/report/rewriter.ts`; the two `review` calls for run 1458 in `runs/trace.jsonl`). It reads: "Oat Milk Honey Latte, $6.50. Local wildflower honey. Slow mornings, done right. New on the menu at South Congress Coffee." We simulated it against A on the same 600 people (run `20261027-south-congress-coffe-13b7`, hosted Lightning via Nightshift): A 29.0% vs C 30.1% (±5.5), +1.0 point, short of the 3.6-point bar. So: keep A.

## 9. What stops the agent spending money?
Drafting and simulating a new version need no approval. Anything that spends or publishes waits for the owner. Approval creates one paused campaign, ad set and ad for the chosen version. It is not Meta's split-test study object. The code refuses any other status (`src/actions/meta.ts`). Without credentials it shows the requests and sends nothing. Live launch is optional: a live attempt in our sandbox currently fails at ad creative ("Select a Facebook Page"), so the demo shows the preview.

## 10. How do you keep simulated people from making things up?
A rule-based guard screened every decision. In the headline run it flagged 199 of 3,328 (for example 40 reasons that invented a price). Report claims must cite query ids and a critic rejects the rest. Interviews answer only from memory lines, and the focus group has an anti-repeat guard so seats do not copy each other.

## 11. The simulated people share one model. Isn't that a problem?
Yes. Their views are less varied than a real crowd's. The Census-sampled traits add variety, but the underlying model is shared. We treat results as a check on whether posts differ at all, not as a market.

## 12. Where do Nemotron, Nightshift and Zetaris fit?
Four models, four jobs. In the headline run, Nightshift served the crowd (394 calls) and voices (24 calls) on Nemotron 3.5 Lightning. Reasoning (2 calls) ran on Nemotron 3.5 Super through direct NVIDIA, because Nightshift excludes Super VL today. Nemotron 3 Ultra is the critic and honesty check; we saw it served through Nightshift in the 20-person hosted trace (`output_examples/hosted/`). Nemotron 3 Nano 4B runs the whole product locally; it ran the earlier 600-person run. All 7 audience-building queries of the headline run ran on Zetaris 2.4.3; per-run `sim.*` tables stay on DuckDB, labelled. See docs/SPONSOR_TECH.md.

## 13. Intent isn't a visit. What does the metric mean?
Right. It is stated intent to visit in a simulation. Clicks are not visits either. The launch plan names the real metric and stop rules for the test worth running.

## 14. Can I reproduce it?
Yes, three ways (README quick start). Sample mode needs no credentials: it replays recorded answers when the prompt matches, and otherwise uses an offline rule-based persona model, labelled `offline-model`. `npm run smoke` replays a recorded 40-person café run with no provider. The 600-person runs are kept as their saved action logs (`runs/<id>/`).

## 15. What are the limits?
Agents share one model. The backtest uses 2013 to 2015 news headlines, not small-business posts. Clicks are not visits. The customer CSV is synthetic. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0).

## 16. What is pre-existing?
`engines/` is the vendored Meterless reference code (upstream commit 1742dec, 19 Oct, Apache-2.0, unchanged). The repository's initial commit is 24 Oct.

## 17. Did anything go wrong in the headline run?
One thing, and we fixed it. The audience-size join first returned 10,206 Instagram users on Zetaris, because Spark read `\d` in a SQL string as `d`, so every age fell into the 65+ band. We changed it to `[0-9]+` (commit e47d5af, works on both engines) and recomputed this run's audience with `scripts/fix-audience.ts`. The correct figure is 27,006. The crowd sampling used other queries and was unaffected, but the "108%" and "3.4 points" figures depend on the corrected audience.

## 18. Does Ripple make the ads?
It renders an Instagram-style ad mockup and banner per version (`src/actions/creative.ts`). The Meta launch is approval-gated: one PAUSED campaign, ad set and ad for the chosen version, with a fixed daily budget. In preview mode it shows the exact requests and sends nothing.

## 12. Which platforms, version types and places work?
Platforms: instagram, facebook, tiktok, youtube, x, reddit (Pew rates per platform; LinkedIn is not supported, we have no Pew data). Versions: post, image, ad (headline, primary text, CTA, image) and campaign (2 or 3 posts across rounds). Places: any US ZIP (Census ACS) or a country or "City, Country" (World Bank, country-level; the city is a label). Outside the US we apply US Pew rates as a labelled proxy and scale the audience by internet users %; income comes from World Bank quintiles and education from a labelled prior. Limits: for images the crowd reacts to a vision model's description, not pixels, and image tests were checked with one vision call, not a full live run. Six countries (GBR, IND, DEU, CAN, AUS, MEX) are cached and work offline.
