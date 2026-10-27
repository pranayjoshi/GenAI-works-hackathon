# Dry Run: pitch deck outline

Entered track: "Track 3, Reasoning Architecture: Demonstrate a novel ability to turn data, knowledge, memory, and reasoning into reliable decisions and actions." Also targeting Best use of NVIDIA Nemotron.

Each layer of the architecture maps to one word of that sentence. Results come from the saved run `runs/20261027-south-congress-coffe-e52a` (600 simulated people, local Nemotron 3 Nano 4B, 3.3 hours) and the Upworthy backtest `samples/backtest/2026-10-27T04-59-44-210Z.json`. The Version C result is a placeholder until it is inserted.

## Slide 1. Dry Run
**On slide:**
- Dry Run
- Before you pay for an A/B test, find out whether it can tell anything apart.
- Open Agent Hackathon 2026. Track 3, Reasoning Architecture. Nemotron.

**Speaker notes:** A café on South Congress in Austin has two versions of an Instagram post. The usual move is to pay for a test. We test them on a simulated crowd first. Then the agent decides whether the real test is worth buying, and acts on that decision.

## Slide 2. The sentence is the architecture
**On slide:**
- data, knowledge, memory, reasoning
- reliable decisions and actions
- One layer per word

**Speaker notes:** Track 3 asks us to turn data, knowledge, memory and reasoning into reliable decisions and actions. We built one layer for each word. The next six slides go through them in order. Data is the federated SQL layer. Knowledge is the Census and Pew join plus labelled priors. Memory is one H-MEM per person per world. Reasoning is twin worlds, two seeds and a report agent that cites its queries. Reliable decisions is the spend decision. Actions is the approval-gated Meta Ads test.

## Slide 3. Data
**On slide:**
- ACS 2024 5-year (Census Reporter REST), Pew platform use, labelled behaviour priors, a synthetic customer list, Upworthy archive
- One federated SQL layer: Zetaris client, local DuckDB fallback
- Every persona field has a receipt (a query id)

**Speaker notes:** The crowd is sampled from Census rows for ZIP 78704 and Pew Instagram rates, not invented by a model. A model writes only each person's one-line voice, after it sees the numbers. The customer list is synthetic, built with a copula, and we say so. Proof: receipts on every persona, and the queries in the run's action log. Data sources: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0).

## Slide 4. Knowledge
**On slide:**
- Census x Pew join gives the real audience size: about 27,006 Instagram users in 78704
- Behaviour parameters are labelled priors, not measurements
- The knowledge tells the agent how many people a test could reach

**Speaker notes:** Knowledge here is what we know about the place. The join tells us how many Instagram users the café can actually reach. That number matters later, because it decides whether a real test is even possible. Priors, such as how likely someone is to speak up, are labelled as priors everywhere they appear.

## Slide 5. Memory
**On slide:**
- One Meterless H-MEM per person per world
- World Model: twin worlds are forks with hash-verified identical base logs
- Markovian: one step per round, bounded carryover
- "Ask why": answers come only from memory, with memory lines cited

**Speaker notes:** A and B start from the same base log, checked by hash. Only the post differs. Each person remembers only what they saw. Asked about something they never saw, they say so. Proof: the Ask why stage in the UI, and the fairness hashes in the run.

## Slide 6. Reasoning
**On slide:**
- 600 simulated Instagram users, 12 two-hour rounds, 2 seeds
- Verdict in code: wins every seed and beats the 95% interval, else "too close to call"
- Result: A 29.6% vs B 26.7%, inside ±5.5 points. Too close to call.
- Tied before the competitor's "30% off" post (35.3 vs 35.6, 37.2 vs 37.2). The gap opened after it.

**Speaker notes:** A was ahead in both seeds, but neither seed was significant on a paired test. We report no measurable difference. We describe when the gap opened, not what caused it, because we have no run without the competitor event. Also: 874 reactions were written and kept private, 439 of them on the café post. Only 68 became public comments on it. No shares in this run.

## Slide 7. Reliable
**On slide:**
- Twin-world hashes, 2 seeds that must agree, a 95% interval
- Rule-based guard fired on 731 of 4,146 decisions
- Report claims must cite query ids. A critic rejects the rest.
- Backtest: 22.5/50 (45.0%, CI 32.1-58.7). Coin: 50%.

**Speaker notes:** Be direct about the backtest. On 50 held-out Upworthy headline tests, the local 4B crowd scored 22.5 of 50. Single prompts scored 24 and 25. No method beat chance on the 4B model. That is why the decisions are built on measured uncertainty and abstention, not on picking winners. The guard screened every decision before it was logged. Limits are on the last slide.

## Slide 8. Decision
**On slide:**
- "Don't pay to A/B test these two posts."
- A real test needs 3,828 people per version (7,656 total, 5% two-sided, 80% power) = 28.3% of the Instagram users in 78704
- Capped at 20% of the audience (2,700 per version), a test detects only about 3.5 points
- Version C, drafted from the quoted objections, passed the Honesty check

**Speaker notes:** This is the centrepiece. The decision does not need the crowd to predict a winner. It needs the measured gap and the real audience size. The objection "Put off by price" appeared on both versions. A drew people on taste and ingredients, B on the discount. The agent drafted C: "Your new morning ritual: Oat Milk Honey Latte, $6.50. 20% off this week. Local wildflower honey. South Congress Coffee." Then it simulated C on the same crowd, hosted Nemotron 3.5 Lightning via Nightshift. <<C_RESULT: Version C moved intent by X points on the same crowd ... >> Then it re-decided against the 3.5-point bar.

## Slide 9. Actions and policy
**On slide:**
- Free and reversible steps run on their own: cancel the test, draft C, simulate C, re-decide
- Anything that spends or publishes waits for the owner's approval
- Approve: one campaign, one ad set per version, same ZIP + age targeting and budget, ALL PAUSED
- No Meta credentials: it shows the exact requests and sends nothing

**Speaker notes:** The code refuses to create anything that is not paused. We recommend a sandbox ad account so nothing can spend. Proof: `src/actions/meta.ts` and the Decision stage, where you can download the plan.

## Slide 10. Nemotron, and what we do not claim
**On slide:**
- Demo run: local Nemotron 3 Nano 4B. Nothing hosted in the 600-person run.
- Now: crowd on Nemotron 3.5 Lightning via Nightshift; reasoning on 3.5 Super; review, critic and honesty on 3 Ultra. `served_by` is logged per call.
- Limits: agents share one model; the backtest uses 2013-2015 news headlines, not small-business posts; clicks are not visits; the customer CSV is synthetic

**Speaker notes:** Say the limits out loud. The simulated people all come from the same model family, so their disagreements are narrower than a real crowd's. The Upworthy headlines are not Instagram posts. Intent is stated, not a visit. The point of the architecture is to say "not worth paying for" when the evidence says so, then to act safely.
