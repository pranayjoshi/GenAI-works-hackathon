# Live run through Nightshift and Zetaris

`example_1_live.json` is the `POST /run` response for `input_examples/example_1.json` with `crowd` set to 20 (to keep a live run short), run on 27 Oct 2026 against Meterless Nightshift and the local Zetaris bundle. It took 6 min 53 s.

`example_1_live.trace.jsonl` is that run's agent trace, copied unedited from `logs/20261027-south-congress-coffe-6264.jsonl`. In it:
- every model request names its model and route: 13 calls `nightshift:nvidia/nemotron-3.5-lightning-30b-a3b` (crowd, voices), 1 `nightshift:nvidia/nemotron-3-ultra-550b-a55b` (report critic), 3 direct NVIDIA Super calls (reasoning; Nightshift excludes Super VL). This trace predates the change that removed the direct-NVIDIA path: the app now holds no NVIDIA key and reasoning runs on Ultra through Nightshift;
- 7 audience-building queries answered by `zetaris`, 11 run-table queries by local DuckDB;
- the ReportCritic flags 5 code-check issues, requests a revision, the revision does not validate, and the first draft ships with the notes attached.
