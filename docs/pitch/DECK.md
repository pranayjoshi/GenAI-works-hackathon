# Dry Run: pitch deck outline

Track 3, Reasoning Architecture: "turn data, knowledge, memory, and reasoning into reliable decisions and actions." The deck has one layer per word. All results are from the saved run `runs/20261027-south-congress-coffe-e52a` and the Upworthy backtest, on local Nemotron 3 Nano 4B through Ollama.

## Slide 1. Dry Run
**On slide:**
- Dry Run
- Before you pay for an A/B test, find out whether it can tell anything apart.
- Open Agent Hackathon 2026, Track 3: Reasoning Architecture

**Speaker note:** A small business has two versions of a post. The usual move is to pay for a test. We simulate a crowd first, and then decide whether the paid test is worth buying. Our example is a café on South Congress in Austin.

## Slide 2. The problem and the sentence
**On slide:**
- Two posts. A paid test costs money and needs a lot of people.
- Most small shops cannot reach enough people to see a small difference.
- Track 3: data, knowledge, memory, reasoning, reliable decisions, actions

**Speaker note:** Read the track sentence. Say that the deck follows it one word at a time and ends on the action, because the action is the part owners care about.

## Slide 3. Data
**On slide:**
- US Census ACS 5-year (via Census Reporter), Pew Instagram use, labelled behaviour priors, a customer CSV
- One federated SQL layer. Every query has an id.
- Zetaris client built to the published API. Local DuckDB answered every query so far.
- Demo customer CSV is synthetic.

**Speaker note:** 600 simulated Instagram users in ZIP 78704, drawn from Census rows and Pew rates. Age 25-34 is oversampled to 50%. Be plain that no live Zetaris instance has been used yet. The client passes a contract test against a fake server built from Zetaris's spec. Each query records which engine answered. Proof: `src/data/federation.ts`.

## Slide 4. Knowledge
**On slide:**
- Every behaviour parameter is a labelled prior (MODELED PRIOR or ASSUMED)
- Every persona field has a receipt: query id and table cell
- The model writes one line of voice per person and never sees gender
- No race, ethnicity, nationality or religion anywhere

**Speaker note:** Knowledge here means we can show where each number came from. The 4B model supplies voice only. Proof: `data/sources/priors_behaviour.csv`, personas.csv in the run folder.

## Slide 5. Memory
**On slide:**
- Meterless H-MEM: one memory per person per world
- Recalled before every decision
- Interviews answer only from memory and cite the memory lines
- Ask about something they never saw: they say so

**Speaker note:** Demo this in the video. Pick one person, ask why they scrolled past, and show the cited lines. Proof: `src/memory/hmem.ts`.

## Slide 6. Reasoning
**On slide:**
- Twin worlds (Meterless World Model): same base log, verified by hash. Only the post differs.
- Meterless Markovian: one step per round, a checkpoint carries the world forward
- A simulated day: 12 two-hour rounds, 2 seeds
- Competitor post injected at round 8 into both worlds
- Report agent with SQL tools, a code critic and a model critic

**Speaker note:** Every report claim cites a query id and every quote is an action id. The critics reject uncited numbers and invented prices. Proof: the twin-world fairness test in `npm test`.

## Slide 7. Reliable decisions
**On slide:**
- A wins only if it wins both seeds and the gap beats the 95% interval
- Result: A 29.6% vs B 26.7%, gap 2.9 points, ±5.5. Too close to call.
- Tied before the competitor's post in both seeds. The gap opened after it. We do not claim a cause.
- Fact-and-coherence guard fired on 731 of 4,146 decisions (17.6%)
- 874 reactions written and kept private; 68 public comments on the café post

**Speaker note:** The system is built to say "too close to call" and here it did. No shares happened in this run, so we say nothing about spread. The guard is rule-based, for example it cancels a would-visit from someone who strongly disliked the post.

## Slide 8. Why it abstains: the backtest
**On slide:**
- 50 held-out Upworthy headline A/B tests (2013-2015 news headlines, not small-business posts)
- Crowd 22.5/50 = 45.0% (95% CI 32.1 to 58.7)
- Single prompt: 48% (thinking on), 50% (off). Coin flip: 50%.
- Exact McNemar crowd vs prompt, p = 0.83
- At chance on the local 4B model.

**Speaker note:** Say this early and directly. A 4B model does not predict which headline wins, and neither does one prompt to it. 50 tests cannot detect a difference under about 15 points. That is why the product does not pick winners. It says when it can't, and it turns that into a spend decision. Hosted Nemotron rerun is one command (`npm run backtest -- --slice scored --n 50`) and has not been run.

## Slide 9. Actions: the spend decision (centrepiece)
**On slide:**
- "Don't pay to A/B test these two posts: they are too close to tell apart with the people South Congress Coffee can reach. Test a bolder version instead."
- A real test needs 3,828 people per version (7,656 total; 5% two-sided, 80% power)
- About 27,006 Instagram users in 78704 (Census x Pew join): that is 28.3% of them
- At most 20% of the local audience (2,700 per version) detects only about 3.5 points
- Auto, done: don't pay for A vs B. Auto, done: draft version C from the quoted objections (price was the top objection for both), passed the honesty check.
- Auto, proposed: simulate C vs A on the same crowd.
- Needs approval: run the real test A vs C, 2,700 per version, core 25-34 first.
- Free, reversible steps run on their own. Anything that spends or publishes waits for the owner. Approving exports `launch_plan.json`. Nothing is posted or spent.

**Speaker note:** This is the point of the deck. The simulation is not asked to be right about who wins. It is asked whether a paid test could settle it. The audience size is an estimate (ACS adults in the ZIP times national Pew use by age). Proof: `src/report/decision.ts`, `launch_plan.json`.

## Slide 10. Honest limits, sponsors, next
**On slide:**
- Limits: agents share one model. The backtest is news headlines. Clicks are not visits. The customer CSV is synthetic. Simulated, not predicted.
- Ran locally on Nemotron 3 Nano 4B. Hosted Nemotron, Nightshift and live Zetaris are wired and switch on with keys (docs/SPONSOR_SETUP.md). Not used in these results.
- Meterless H-MEM, World Model and Markovian are all in the run.
- Data: Upworthy Research Archive (CC BY 4.0), US Census ACS, Pew Research Center.
- Next: hosted backtest, simulate C vs A, one real test.

**Speaker note:** The run took 3.3 hours and the video is a saved run. Close on the loop: the output is a decision about money, and the owner approves it.
