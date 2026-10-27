# Saved runs and logs

All runs used local Nemotron 3 Nano 4B through Ollama. Open any run in the UI at `#/run/<run id>`.

| Run | What it is |
|---|---|
| `runs/20261027-south-congress-coffe-2cfd` | Café demo, 300 people, 12 rounds, 2 seeds, competitor event at round 8. Too close to call: A 31.4% vs B 29.3% (±7.9 pts). |
| `runs/20261027-south-congress-coffe-36a2` | Earlier café demo, 300 people, before the fact-and-coherence guard. Too close to call: A 26.2% vs B 26.1%. |
| `runs/20261027-south-congress-coffe-1787` | 24-person run with the competitor event injected from the UI mid-run; shows the event reaching both worlds in the same round. |
| `runs/bt-261027045944-NN-*` | The 50 Upworthy backtest tests behind `samples/backtest/2026-10-27T04-59-44-210Z.json`. |
| `runs/20261027-south-congress-coffe-e52a` | **The video demo run.** Café, 600 people, 12 rounds, 2 seeds, competitor event at round 8. Too close to call: A 29.6% vs B 26.7% (±5.5 pts), A ahead in both seeds. Tied before the competitor post in both seeds (35.3% vs 35.6%, 37.2% vs 37.2%); A ahead after it. 874 reactions kept private. |

| Log | What it is |
|---|---|
| `samples/logs/demo-600-interrupted.log` | First 600-person attempt, stopped in seed 2. Its seed 1 round-by-round counts are the only record of that seed: A and B tied until the competitor post, then B fell from 32.9% to 25.7% while A held at 32.4%. |
| `samples/logs/demo-600.log` | The video demo run (e52a). |
| `samples/logs/demo-run.log` | The 300-person demo run (2cfd). |
| `samples/logs/backtest-scored.log` | The scored backtest, test by test. |

`samples/recordings.sqlite` holds the recorded model calls that sample mode replays. A live run with the same inputs overwrites matching entries, so restore it from git before recording the video.
