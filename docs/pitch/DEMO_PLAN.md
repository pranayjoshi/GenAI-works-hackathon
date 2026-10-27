# Ripple: demo video plan (target 3:30 to 4:00)

**The story in one line:** a café owner wrote the post for a new latte two ways: one leads with the product, one tells a story. Same latte, same $6.50, no discount. Before she pays for an A/B test, Ripple rehearses it on a simulated neighbourhood built from Census and Pew data, finds the two are too close to call, shows a test big enough to tell them apart would need more people than exist locally, drafts and checks a third version, and lines up the ads paused, waiting for her approval.

One protagonist (South Congress Coffee, Austin 78704), one question ("is this test worth paying for?"). Never jump between businesses. The exact narration lives in [VOICEOVER.md](VOICEOVER.md) (owned by the video producer); this file is the beat plan and the numbers. If they differ, VOICEOVER.md is what gets recorded and the numbers below are what to check it against.

**Headline run:** `runs/20261027-south-congress-coffe-1458`, the copy-only test (`input_examples/demo_copy_only.json`). 600 people, 2 seeds, 12 rounds, a competitor "30% off all lattes" post at round 8. Crowd and voices on hosted Nemotron 3.5 Lightning via Meterless Nightshift (394 crowd + 24 voice calls); reasoning on Nemotron Super via direct NVIDIA (Nightshift excludes Super VL today); all 7 audience-building queries on Zetaris; about 13 minutes wall clock. **Version C check:** `runs/20261027-south-congress-coffe-13b7`. Earlier runs (e52a: local Nano 4B, 3.3 hours; 344c) are not shown in the video.

**Nemotron is the cast, not the backdrop.** Four models, four jobs:

| Model | Job in Ripple | Route |
|---|---|---|
| Nemotron 3.5 Lightning 30B | every simulated person's decision and voice (thinking off) | Nightshift |
| Nemotron 3.5 Super 120B | reasoning: audience segments, report, interviews, the suggested rewrite (C) | direct NVIDIA |
| Nemotron 3 Ultra 550B | the critic: report review and the honesty check on the suggested rewrite | Nightshift |
| Nemotron 3 Nano 4B | the whole product on a laptop; the offline fallback | local Ollama |

**Live vs saved.** Live: the creation beat, the interview, the focus group, the terminal. Saved: run 1458 and run 13b7. Put a "saved run" corner label on every saved-run shot.

## Beats

| Time | Act | Screen | Say (numbers checked against the run files) |
|---|---|---|---|
| 0:00-0:26 | **Story and title** | Intro cards, then the Ripple icon | Two ways to write the same latte post. Same price. Which words bring more people in? She could pay for a test; if the two are too close to call, that money is gone. Ripple rehearses it first. |
| 0:26-1:06 | **Create** (live) | New test form with both posts; Data sources panel on the New test screen; query receipts; Nemotron panel | Business, ZIP, goal, posts A (product-first) and B (story-first). A data agent counts the audience from Census and Pew on Zetaris. Four sources are federated per run: Census ACS (via Census Reporter), Pew Instagram use by age, behaviour priors (modeled, labelled), and a synthetic customer list. Every person has a receipt. |
| 1:06-1:26 | **Simulate** (saved) | Audience stage (Data sources panel); Counterfactual worlds hash chips | 600 people, each sampled from real distributions. Two identical worlds, verified by hash; only the post differs. |
| 1:26-1:37 | **The curveball** (saved) | Signals: round-8 flag | A competitor across the street posts 30% off all lattes in both worlds at once. Before it A led slightly (seed 1 27.6% vs 25.2%; seed 2 31.8% vs 29.6%). Intent fell in both worlds after it. Do not say it caused anything. |
| 1:37-2:03 | **Analyse** (saved) | Result, then Report: a quote opens its action | A 24.8%, B 23.4%, inside ±5.1 points. A ahead in 2 of 2 seeds. No measurable difference. Customers 51.1% A vs 45.9% B (116 people); income $50-75k 18.9% A vs 28.8% B (66 people). 2,148 reactions to the post, 1,882 scroll-pasts, 60 kept private against 13 public comments. |
| 2:03-2:30 | **Ask** | One person in both worlds; Why (live); focus group (live) | They answer only from their own memory and cite it. The focus group seats six; each answers from their own memory, and an anti-repeat guard stops copied answers. |
| 2:30-2:55 | **Decide and act** (saved) | Spend gate stage: needed vs reachable bar; suggested rewrite card; ad mockups; approval panel | A real test needs 14,637 people per version (29,274), 108% of the 27,006 Instagram users in the ZIP, so don't pay. An affordable test (20%, 2,700 per version) detects about 3.4 points. Version C: "Oat Milk Honey Latte, $6.50. Local wildflower honey. Slow mornings, done right. New on the menu at South Congress Coffee." Simulated against A on the same 600 people: A 29.0% vs C 30.1% (±5.5), +1.0 point, short of the 3.6-point bar. Keep A. Ripple renders an Instagram-style mockup per version; approving builds one campaign with two PAUSED ad sets, identical targeting, a fixed daily budget. Without Meta credentials it shows the exact requests and sends nothing. |
| 2:55-3:15 | **Proof** | Terminal: trace of `output_examples/hosted/example_1_live.trace.jsonl` | Named agents, the critic's revision request, every Zetaris query, the model behind every call. One curl runs it, even with no keys. |
| 3:15-3:40 | **Impact and close** | Four-models card, then limits card | Four Nemotron models, four jobs. Limits on the card: simulated people, not real customers; agents share one model; the customer list is synthetic; the backtest used 2013-2015 headlines and no method beat chance on the 4B model. |

If over 4:00: cut the curveball to one sentence, then shorten Proof.

Say "on the same audience" for the suggested rewrite (C): run 13b7 had no competitor event, so its A rate (29.0%) differs from run 1458's (24.8%).

## Terminal beat commands

```bash
python3 -c "import json;[print(r['agent_name'],'->',r.get('target_agent') or '','|',r['action'],r['status'],'|',r.get('served_by') or '') for r in map(json.loads,open('output_examples/hosted/example_1_live.trace.jsonl'))]" | head -60
```

```bash
curl -s -X POST http://localhost:8000/run -H "Content-Type: application/json" -d @input_examples/example_2.json | head -c 600
```

The second command is the Docker image in sample mode (about a second, `offline-model` in its trace): call it sample mode on camera. The live trace is the first command (a 20-person café run that took 6 min 53 s, from earlier on 27 Oct, not the headline run).

## Pre-recording checklist

- [ ] Restart the UI server so it runs the current code: stop the old one on :8787, then `npm start`.
- [ ] Nightshift running; `npm run probe` shows `nightshift ONLINE` and `served_by=nightshift:…`.
- [ ] Zetaris up and registered; probe reports `Federated SQL engine: zetaris`. Use ZIP 78704 for the live beat (its queries are warm; a new ZIP's first Zetaris query can take a minute under emulation).
- [ ] Dry-run the live creation beat once before recording: a 20-person hosted run builds its crowd in about a minute; the full run takes about 7 minutes, so cut away after the crowd is built.
- [ ] Docker image on :8000 for the curl (`docker run --rm -p 8000:8000 -e SAMPLE_MODE=true oah-submission`).
- [ ] Tabs open in order: New simulation, 1458 (Audience, Counterfactual worlds, Signals, Result, Report, Why, Spend gate), 13b7.
- [ ] Meta: only show a live Approve if a sandbox launch succeeded today; otherwise leave `META_*` unset and narrate the preview.
- [ ] Focus group: run it once before recording and check the answers differ (the anti-repeat guard is on, but check).
- [ ] No credentials on screen: no `.env`, no Nightshift Console or Providers tab, no terminal env dump.
- [ ] Rehearse once with a timer; record the voiceover separately if the live waits break the rhythm.
