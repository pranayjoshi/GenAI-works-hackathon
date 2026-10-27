# Ripple: demo video plan (target 3:45, hard cap 4:00)

**The story in one line:** a café owner is about to pay for an A/B test of two Instagram posts. Ripple rehearses that test on a simulated neighbourhood built from real Census and Pew data, tells her the test can't find a winner, drafts a better post, checks it, and only then lines up the ads — paused, waiting for her approval.

One protagonist (South Congress Coffee, Austin 78704), one question ("is this test worth paying for?"), and every beat answers the next part of it: **create → simulate → analyse → ask → decide → act → proof**. Never jump between businesses.

**Nemotron is the cast, not the backdrop.** Keep a small corner badge on screen naming the Nemotron model doing the work in each beat:

| Model | Job in Ripple | Route |
|---|---|---|
| Nemotron 3.5 Lightning 30B | every simulated person's decision and voice (hundreds of fast calls, thinking off) | Nightshift |
| Nemotron 3.5 Super 120B | reasoning: audience segments, report, interviews, Version C | direct NVIDIA (Nightshift excludes Super VL today) |
| Nemotron 3 Ultra 550B | the critic: report review and the honesty check on Version C | Nightshift |
| Nemotron 3 Nano 4B | the full 600-person run on a laptop, and the offline fallback | local Ollama |

**Live vs saved.** Live: the creation beat (20-person hosted run), the interview, the approval panel, the terminal. Saved: the 600-person run `20261027-south-congress-coffe-e52a` (it took 3.3 h on Nano 4B) and the Version C check `20261027-south-congress-coffe-344c` (11.7 min on Lightning via Nightshift). Put a "saved run" corner label on every saved-run shot.

## Beats

| Time | Act | Screen | Voiceover (read it; numbers are from the runs) | Badge |
|---|---|---|---|---|
| 0:00–0:20 | **Hook** | Title card with the Ripple icon, then the home screen | "This is South Congress Coffee. They have two Instagram posts for a new latte: one at full price, one at 20% off. The usual advice is: pay for an A/B test. Ripple asks a better question first: can that test even tell these two apart?" | — |
| 0:20–0:50 | **Create** (live) | New test: business, ZIP 78704, goal, posts A and B; crowd 20; Run. Then the Agents stage and query receipts | "I type the business, the ZIP and both posts. An audience agent names who to reach. It never decides how many people exist: a data agent counts them from Census and Pew through Zetaris. Every person has a receipt, a query id." Show a receipt with engine `zetaris`, then the Nemotron panel showing `nightshift:…lightning`. | Super → Lightning |
| 0:50–1:10 | **Simulate: the crowd** (saved 600) | Crowd stage, open one persona and its receipt | "For the full test we ran 600 people in this ZIP. Each one is sampled from real distributions — age, income, how often they use Instagram, whether they're already a customer." | Nano 4B (saved run) |
| 1:10–1:30 | **Simulate: twin worlds** (saved) | Twin worlds: the two matching hash chips; open a person's memory lines | "Every person lives in two identical worlds. Same people, same follows, same day — verified by hash. The only difference is the post. Each person remembers what they saw on the Meterless H-MEM memory engine." | H-MEM |
| 1:30–1:45 | **Simulate: the curveball** (saved) | Signals: the timeline with the round-8 flag | "Mid-morning, a competitor across the street posts 30% off all lattes. It reaches both worlds at the same moment. Before it, A and B were tied — 35.3 to 35.6. The gap opened after." (Do not say it caused the gap.) | Lightning/Nano |
| 1:45–2:05 | **Analyse** (saved) | Verdict stage, then Report: click a quote → its action | "The verdict is code, not a model's opinion: A 29.6%, B 26.7%, inside ±5.5 points. Too close to call. The report cites a query for every number, and a critic on Nemotron Ultra checks it and sends it back when a number doesn't match. And 874 people reacted but said nothing in public — only 68 commented. Ripple hears the silent ones." | Ultra |
| 2:05–2:25 | **Ask** (live on the saved run) | Ask why: pick p0176 in world A, ask "Why did you scroll past the oat milk honey latte post?" | Let the answer play (about 6 s on Super). Real answer from rehearsal: "$6.50 for a latte is just too much when I'm watching every dollar, so I kept scrolling." VO: "They answer only from their own memory of the day — no invented backstory." | Super |
| 2:25–2:55 | **Decide** (saved) | Decision stage: needed vs reachable bar; then Version C card; then open 344c | "Here's the decision. To tell these posts apart, a real test needs 3,828 people per version — 28% of everyone on Instagram in this ZIP. A test she can afford only detects a 3.5-point gap. So: don't pay for this test. Instead, Ripple drafted Version C from the price objections, Nemotron Ultra checked it invents no new claims, and one click ran C against A on the same crowd, through Nightshift: C moved intent 1.1 points. Not enough. Keep A, save the money." | Super → Ultra → Lightning |
| 2:55–3:15 | **Act** | Decision stage approval panel; click Approve | "Free, reversible steps already ran. Anything that spends money waits for the owner. Approve, and Ripple builds the campaign in Meta Ads: two ad sets, identical targeting, a fixed daily budget — every object created paused." If Meta is not live: "Without Meta keys it shows the exact requests and sends nothing." | — |
| 3:15–3:35 | **Proof** | Terminal: `output_examples/hosted/example_1_live.trace.jsonl` scrolled through | "Every step is in the trace: named agents handing off, the critic asking for a revision, every Zetaris query, and the Nemotron model behind every request — Lightning and Ultra through Nightshift, Super for reasoning. Judges can run the same thing with one curl, even with no keys." | all four |
| 3:35–3:50 | **Impact + close** | Closing card: the four-models table and the limits line | "Ripple told a café not to spend money on a test it couldn't win, showed why in its customers' own words, and set up the next step for one click. Four Nemotron models, each doing the job it's best at." Limits on the card: "Simulated people, not real customers. Customer list is synthetic. On 50 historical tests no method beat chance on the 4B model." | — |

If over 4:00: cut the curveball beat to one sentence, then shorten Proof.

## Terminal beat commands

```bash
python3 -c "import json;[print(r['agent_name'],'->',r.get('target_agent') or '','|',r['action'],r['status'],'|',r.get('served_by') or '') for r in map(json.loads,open('output_examples/hosted/example_1_live.trace.jsonl'))]" | head -60
```

```bash
curl -s -X POST http://localhost:8000/run -H "Content-Type: application/json" -d @input_examples/example_2.json | head -c 600
```

The second command is the Docker image in sample mode (about a second, `offline-model` in its trace): call it sample mode on camera. The live trace is the first command (a 20-person café run that took 6 min 53 s).

## Pre-recording checklist

- [ ] Restart the UI server so it runs the current code: stop the old one on :8787, then `npm start`.
- [ ] Nightshift running; `npm run probe` shows `nightshift ONLINE` and `served_by=nightshift:…`.
- [ ] Zetaris up and registered; probe reports `Federated SQL engine: zetaris`. Use ZIP 78704 for the live beat (its queries are warm; a new ZIP's first Zetaris query can take a minute under emulation).
- [ ] Dry-run the live creation beat once before recording: a 20-person hosted run builds its crowd in about a minute; the full run takes about 7 minutes, so cut away after the crowd is built.
- [ ] Docker image on :8000 for the curl (`docker run --rm -p 8000:8000 -e SAMPLE_MODE=true oah-submission`).
- [ ] Tabs open in order: New test, e52a (Crowd), e52a (Twin worlds, Signals, Verdict, Report, Ask why, Decision), 344c.
- [ ] Meta: only show a live Approve if a sandbox launch succeeded today; otherwise leave `META_*` unset and narrate the preview.
- [ ] Skip the focus group: in rehearsal three of five answers repeated each other.
- [ ] No credentials on screen: no `.env`, no Nightshift Console or Providers tab, no terminal env dump.
- [ ] Rehearse once with a timer; record the voiceover separately if the live waits break the rhythm.
