# Ripple: demo video script (about 3:15)

Beat-by-beat plan, runs to open and the pre-recording checklist are in [DEMO_PLAN.md](DEMO_PLAN.md). This file is the voiceover. The long parts show saved runs and say so on screen. Voiceover is about 470 words.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:12 | Title card, then the UI home. | A café on South Congress in Austin has two Instagram posts. The usual move is to pay for an A/B test. Ripple asks a better first question: can that test tell these two apart? |
| 0:12-0:30 | New test form, then the Agents stage. | You give it the business, the ZIP and the two posts. An Audience agent names the segments. It never sets their size. |
| 0:30-0:55 | Nemotron panel and query receipts. Label: live, 20 people. | The crowd comes from data. These queries run on Zetaris: Census rows for the ZIP, Pew Instagram rates, behaviour priors. Every field has a receipt. The panel shows which model answered each call. |
| 0:55-1:15 | Twin worlds stage. Label: saved run. | Two worlds start from the same base log, verified by hash. Only the post differs. Each person has their own memory. |
| 1:15-1:30 | Signals stage, competitor flag at round 8. | A competitor's "30% off all lattes" post reaches both worlds in the same round. Before it, A and B were tied. The gap opened after it. We cannot say it caused it. |
| 1:30-1:45 | Verdict stage. | The verdict is code. A 29.6 percent, B 26.7 percent, inside plus or minus 5.5 points. Too close to call. |
| 1:45-2:05 | Report stage, quote linked to its action. | Every claim cites a query. Every quote links to an action. A critic can send the report back for a revision. 874 reactions were written and kept private. |
| 2:05-2:25 | Ask why, then the focus group. | Ask any person why. They answer only from their own memory lines. Or ask a whole segment, or run a focus group. |
| 2:25-2:45 | Decision stage. | The agent says: don't pay to test these two posts. A real test needs 3,828 people per version. That is 28.3 percent of the Instagram users in the ZIP. Capped at 20 percent, a test sees only about 3.5 points. |
| 2:45-3:05 | Version C, then run 344c. Label: saved run. | It drafted Version C from the quoted price objections, and the honesty check passed. One click simulates C against A on the same 600 people, on hosted Nemotron through Nightshift. C moved intent by 1.1 points, 14.6 against 13.5. Short of the bar. Keep A. |
| 3:05-3:15 | Approval panel. | Spending waits for the owner. Approve, and Ripple creates two paused ad sets in one campaign. With no Meta credentials it shows the exact requests and sends nothing. |
| 3:15-3:30 | Terminal: curl /run and tail the log, then the limits card. | Here is the same pipeline from the command line, with every agent and the model that answered. Limits: the simulated people share one model, and on 50 Upworthy tests no method beat chance on the 4B model. So Ripple decides on measured uncertainty. |

## Notes for the recording

- Say "simulated", never "predicts customer behaviour". Say "600 simulated people", never "real people's data".
- The 600-person run used local Nemotron 3 Nano 4B and took 3.3 hours. Say it is a saved run. The Version C run used hosted Lightning through Nightshift.
- Closing card text: "Limits: agents share one model. Backtest used 2013-2015 news headlines. Clicks are not visits. Customer CSV is synthetic. Data: Census ACS, Pew Research Center, Upworthy Research Archive (CC BY 4.0)."
- Meta live launch is optional and currently fails in our sandbox at ad creative. Show the preview.
- No credentials on screen.
