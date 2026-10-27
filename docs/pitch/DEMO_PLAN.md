# Ripple: demo video plan (3:00 to 3:30)

The 600-person run took 3.3 hours, so the long parts use saved runs. Say on screen, in a corner label, "saved run" whenever one is shown. Nothing is recorded as live unless it is.

Runs to open (all under `runs/`, UI at `#/run/<id>`):
- `20261027-south-congress-coffe-e52a`: the 600-person café run (verdict, report, signals, Ask why). Saved.
- `20261027-south-congress-coffe-344c`: Version C vs A on hosted Lightning via Nightshift. Saved.
- `20261027-south-congress-coffe-1787`: 24-person run with an event injected from the UI mid-run. Saved. Or start a fresh 20-person hosted run for the live beats.
- A fresh small run (20 people, hosted) for the live crowd building and query receipts, if the pre-recording check passes. Otherwise show 1787 and say it is saved.

## Beats and timing

| Time | Beat | Screen | What to say or show |
|---|---|---|---|
| 0:00-0:12 | Problem | Title card with the icon, UI home | A café has two posts. Before paying for a test, can the test tell them apart? |
| 0:12-0:30 | Create a test | New test form: business, ZIP 78704, A and B posts, Load example | Fill business, ZIP, goal, two posts. Start a small run. |
| 0:30-0:55 | Live crowd building | Agents stage and Nemotron panel; query receipts | AudienceAgent names segments. DataAgent queries run on Zetaris: show the engine label on the query receipts. Show `served_by` in the Nemotron panel (nightshift). Say "20-person run, live". |
| 0:55-1:15 | Twin worlds and memory | Twin worlds stage (e52a, saved) | Identical base-log hashes. Open a person: their H-MEM lines. Only the post differs. |
| 1:15-1:30 | Mid-run event | Signals stage with the injected flag (1787 or e52a at round 8, saved) | The competitor's "30% off all lattes" reaches both worlds in the same round. A and B tied before it (35.3 vs 35.6, 37.2 vs 37.2); the gap opened after. We cannot say it caused it. |
| 1:30-1:45 | Verdict | Verdict stage (e52a) | A 29.6%, B 26.7%, within ±5.5 points. Too close to call. |
| 1:45-2:05 | Report and critic | Report stage; click a quote to its action; Agents stage showing ReportCritic | Every claim cites a query; every quote links to an action. The critic can request a revision. 874 reactions kept private. |
| 2:05-2:25 | Ask why and focus group | Ask why stage | Ask one person why, show cited memory lines. Ask a question to a segment. Run the focus group and read one question and one answer. Read the actual answer on screen; do not paraphrase from memory. |
| 2:25-2:45 | Spend decision | Decision stage | Needed vs reachable audience: 3,828 per version, 28.3% of the Instagram users in the ZIP; at 20% a test sees about 3.5 points. Don't pay for this test. |
| 2:45-3:05 | Version C | Decision and Ask why stages, then run 344c (saved) | Version C drafted from price objections; honesty check passed. One click simulates C vs A: C 14.6% vs A 13.5%, +1.1 points, below the bar. Keep A. |
| 3:05-3:15 | Approval-gated launch | Decision approval panel | Owner approves. Without Meta credentials: the exact requests are shown, nothing is sent. Two paused ad sets in one campaign, identical targeting, a fixed daily budget. Live launch is optional. |
| 3:15-3:30 | Terminal beat and limits | Terminal, then closing card | See below, 15 seconds. Then the limits card. |

If over time, cut the focus group first, then the report beat to one sentence.

## Terminal beat (15 s)

```bash
curl -s -X POST http://localhost:8000/run -H "Content-Type: application/json" -d @input_examples/example_2.json | head -c 600
```

```bash
tail -n 12 logs/<run_id>.jsonl
```

Show named agents (Orchestrator, DataAgent, CrowdAgent, ModelRouter) and a ModelRouter line with `served_by: nightshift:...`. Use a hosted run so the lines are real. A sample-mode run shows `offline-model` and `none`, and must be called that. Do not edit the output. If `/run` takes longer than the beat, cut to a finished run's log and say it was run beforehand. TODO(number: how long `/run` with example_2 takes hosted; not measured).

## Pre-recording checklist

- [ ] Restore `samples/recordings.sqlite` from git if a live run overwrote it (`samples/README-runs.md`).
- [ ] Start Nightshift (127.0.0.1:8088); `npm run probe` shows `nightshift ONLINE`.
- [ ] Zetaris up (`docker compose up -d` in the bundle), tables registered (`scripts/zetaris-register.sh`), `.env` has `ZETARIS_*`; probe reports `zetaris`.
- [ ] Server on :8787 (`npm start`); for the curl beat, the Docker image on :8000 or `PORT` set accordingly.
- [ ] Open saved runs e52a, 344c and 1787 in tabs, in that order of use.
- [ ] Meta: leave `META_*` unset so the preview shows; do not attempt a live launch on camera.
- [ ] Hide `.env`, the Nightshift Console API key and every token. Use a clean terminal with no env dump. No credentials on screen.
- [ ] Browser zoom so the Nemotron panel is readable; corner label "saved run" ready.
- [ ] Rehearse once with a timer.
