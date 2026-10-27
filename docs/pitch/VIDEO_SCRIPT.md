# Dry Run: 3-minute demo video script

Shown: the saved run `runs/20261027-south-congress-coffe-e52a`, opened in the UI at `#/run/20261027-south-congress-coffe-e52a`. It is a saved run, not a live one. Voiceover is about 430 words, which reads in under 3:00 at a steady pace. Before recording, restore `samples/recordings.sqlite` from git (see `samples/README-runs.md`).

Placeholder: the Version C result is inserted by hand at 2:15.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:15 | Title card, then the UI home with the café run. | A café on South Congress in Austin has two Instagram posts. The usual move is to pay for an A/B test. Dry Run asks a better first question: can that test tell these two apart? |
| 0:15-0:30 | **Agents** stage. | Track 3 asks for data, knowledge, memory and reasoning that become reliable decisions and actions. Here is each one. An Audience agent names the segments. It never sets their size. |
| 0:30-0:50 | **Crowd** stage. Open one persona and show its receipt. | Data. These are 600 simulated Instagram users in ZIP 78704. They are sampled from Census ACS rows and Pew Instagram rates through one federated SQL layer. Every field has a receipt, a query id. The customer list is synthetic. |
| 0:50-1:10 | **Twin worlds** stage. Show the matching base-log hashes. | Memory. Each person has their own memory in each world. The two worlds start from the same base log, verified by hash. Only the post differs. |
| 1:10-1:30 | **Signals** stage. Show the timeline and the competitor post at round 8. | We injected a competitor's "30% off all lattes" post at round 8. Before it, A and B were tied in both seeds: 35.3 to 35.6, and 37.2 to 37.2. The gap opened after it. We cannot say the post caused that. |
| 1:30-1:50 | **Verdict** stage. | Reasoning. The verdict is code. A 29.6 percent, B 26.7 percent, inside plus or minus 5.5 points. A led in both seeds, but neither was significant. Too close to call. |
| 1:50-2:05 | **Report** stage. Click a quote, show its action. 874 private reactions. | Every claim in the report cites a query. Every quote links to an action. 874 reactions were written and kept private. Only 68 became public comments on the café post. |
| 2:05-2:35 | **Decision** stage. Show 3,828 per version, 28.3 percent, the 3.5-point line, then Version C. Then the C result line. | Reliable decisions. The agent says: don't pay to test these two posts. A real test needs 3,828 people per version. That is 28.3 percent of the Instagram users in the ZIP. Capped at 20 percent, a test sees only about 3.5 points. So it drafted Version C from the quoted objections: price. It passed the honesty check. We ran C on the same crowd, on hosted Nemotron through Nightshift. <<C_RESULT: Version C moved intent by X points on the same crowd ... >> |
| 2:35-2:50 | Decision stage, approval panel. Click approve (sandbox, or the dry-run request view). | Actions. Free, reversible steps ran on their own. Spending waits for the owner. Approve, and it builds the split test in Meta Ads. Everything is created paused. The code refuses anything else. |
| 2:50-3:00 | **Ask why** stage, one answer with memory lines, then the closing card with the limits. | Ask any person why. They answer only from memory. One honest limit: on 50 Upworthy tests no method beat chance on the 4B model. So Dry Run decides on measured uncertainty. |

## Notes for the recording

- Say "simulated", never "predicts customer behaviour". Say "600 simulated people", never "real people's data".
- The 600-person run used local Nemotron 3 Nano 4B and took 3.3 hours. Say so if asked. Only the Version C simulation ran on hosted Lightning through Nightshift.
- Closing card text: "Limits: agents share one model. Backtest used 2013-2015 news headlines. Clicks are not visits. Customer CSV is synthetic. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0)."
- If Meta credentials are not set, the approval shows the exact requests and sends nothing. Narrate it that way.
- Rehearse once with a timer. If over, cut the Report beat to one sentence.
