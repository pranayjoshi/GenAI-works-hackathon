# Saved runs and logs

The two headline runs (1458 and 13b7, below) used hosted Nemotron 3.5 Lightning through Meterless Nightshift, with reasoning on Nemotron 3.5 Super through direct NVIDIA. The earlier runs used local Nemotron 3 Nano 4B through Ollama, except 344c. Open any run in the UI at `#/run/<run id>`.

| Run | What it is |
|---|---|
| `runs/20261027-south-congress-coffe-1458` | **The headline demo run (copy-only test).** Café, same Oat Milk Honey Latte at $6.50 in both posts, only the wording differs (`input_examples/demo_copy_only.json`). 600 people, 2 seeds, 12 rounds, competitor "30% off all lattes" post at round 8. Crowd and voices on hosted Lightning via Nightshift (394 + 24 calls), reasoning on Super via direct NVIDIA, all 7 audience queries on Zetaris, about 13 minutes. Too close to call: A 24.8% vs B 23.4% (±5.1 pts), A ahead in 2 of 2 seeds. Decision: don't pay (a real test needs 14,637 per version, 108% of the 27,006 local Instagram users). Its audience was recomputed with `scripts/fix-audience.ts` after the `\d` fix (e47d5af). |
| `runs/20261027-south-congress-coffe-13b7` | The headline decision's check: Version C vs A on the same 600 people, hosted Lightning via Nightshift, no competitor event. A 29.0% vs C 30.1% (±5.5), +1.0 pt, short of the 3.6-point bar: keep A. |
| `runs/20261027-south-congress-coffe-2cfd` | Café demo, 300 people, 12 rounds, 2 seeds, competitor event at round 8. Too close to call: A 31.4% vs B 29.3% (±7.9 pts). |
| `runs/20261027-south-congress-coffe-36a2` | Earlier café demo, 300 people, before the fact-and-coherence guard. Too close to call: A 26.2% vs B 26.1%. |
| `runs/20261027-south-congress-coffe-1787` | 24-person run with the competitor event injected from the UI mid-run; shows the event reaching both worlds in the same round. |
| `runs/20261027-south-congress-coffe-344c` | Earlier run (a different post pair): the decision's own check: Version C vs A on the same 600 people, hosted Nemotron 3.5 Lightning via Nightshift, 11.7 minutes. C +1.1 pts (14.6% vs 13.5%), short of the 3.5-point bar, so the decision is keep A and don't pay for a real test of C. |
| `runs/bt-261027045944-NN-*` | The 50 Upworthy backtest tests behind `samples/backtest/2026-10-27T04-59-44-210Z.json`. |
| `runs/20261027-south-congress-coffe-e52a` | Earlier run, no longer the video demo (different post pair: full price vs a discount; local Nano 4B, 3.3 hours). Café, 600 people, 12 rounds, 2 seeds, competitor event at round 8. Too close to call: A 29.6% vs B 26.7% (±5.5 pts), A ahead in both seeds. Tied before the competitor post in both seeds (35.3% vs 35.6%, 37.2% vs 37.2%); A ahead after it. 874 reactions kept private. |

| Log | What it is |
|---|---|
| `samples/logs/demo-600-interrupted.log` | First 600-person attempt, stopped in seed 2. Its seed 1 round-by-round counts are the only record of that seed: A and B tied until the competitor post, then B fell from 32.9% to 25.7% while A held at 32.4%. |
| `samples/logs/demo-600.log` | The earlier 600-person run (e52a). |
| `samples/logs/demo-run.log` | The 300-person demo run (2cfd). |
| `samples/logs/backtest-scored.log` | The scored backtest, test by test. |

`samples/recordings.sqlite` holds the recorded model calls that sample mode replays. A live run with the same inputs overwrites matching entries, so restore it from git before recording the video.
