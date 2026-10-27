# Ripple demo video: voiceover script

Generated from `scripts/video/timeline.mjs` by `node scripts/video/vo.mjs`. Voice: macOS `say -v Samantha -r 184`.
Numbers are the claim-checked figures of the copy-only demo run `20261027-south-congress-coffe-1458` (600 people, 2 seeds, 12 rounds, Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris). Start times are approximate.

| Start | Act | On screen | Voiceover |
|---|---|---|---|
| 0:00 | Story | intro1 | Meet the owner of South Congress Coffee, in Austin. She wrote her new latte post two ways, and wants to know how the neighbourhood will react. |
| 0:07 | Story | intro2 | One leads with the product, one tells a story. Same latte, same price. Which words bring people in, and what will they think? |
| 0:15 | Story | intro3 | Post it, and you only hear from the loud few. Most people scroll past in silence, and never say why. What if she could watch the neighbourhood react first? |
| 0:25 | Title | logo | This is Ripple. It simulates how the public will react to what you post, and shows you why. |
| 0:30 |  | loop | It's an agent, working in a loop: build the audience, simulate a day, investigate, explain, and recommend. It uses tools, like SQL on its own event log. It critiques and revises its own work. And anything that spends money waits for the owner. |
| 0:46 | 1 · Build the audience | A new test, live | Type the business, the ZIP, the goal, and the post. Here, both drafts. |
| 0:51 | 1 · Build the audience | Who to reach, counted on Zetaris | An audience agent on Nemotron Super names who to reach. It never decides how many people exist: a data agent counts them from Census and Pew, on Zetaris. |
| 1:00 | 1 · Build the audience | Every person has a receipt | Run it. Every simulated person gets a receipt: the query, the exact SQL, and the engine that ran it. |
| 1:06 | 1 · Build the audience | The model behind every call | And every simulated decision runs on Nemotron Lightning, through Nightshift. |
| 1:11 | 1 · Build the audience | Five sources, all answered by Zetaris | Four sources, federated through Zetaris: public Census and Pew data, labelled behaviour priors, and a customer list that is synthetic in this demo. |
| 1:20 | 2 · Simulate | The crowd: 600 people in 78704 | Then it simulates a day. 600 people, each sampled from real distributions, decide on Nemotron Lightning. |
| 1:26 | 2 · Simulate | Twin worlds, verified by hash | To compare two drafts fairly, it runs an A/B test inside the simulation: two identical worlds, verified by hash, where only the post differs. Each person remembers what they saw, on Meterless H-MEM. |
| 1:39 | 2 · Simulate | The curveball at round 8 | Mid-morning, a competitor posts 30% off all lattes. It pulled intent down in both worlds. |
| 1:45 | 3 · Investigate | The verdict is computed | The verdict is computed, not opinion: A leads on intent to visit, 24.8% to 23.4%, ahead in both seeds, and 70% likely to be the better version. |
| 1:55 | 3 · Investigate | Every claim has a receipt | Then it investigates. Every claim cites its query: customers leaned to A; people earning fifty to seventy-five thousand leaned to B. And most stayed silent: 60 people wrote a reaction they kept private, against 13 public comments. |
| 2:09 | 4 · Explain | Same person, two worlds | One person, in both worlds. The product-first post gave them a reason to try it. The story-first one? Six fifty felt steep for a daily habit. |
| 2:18 | 4 · Explain | Interview, live | Ask them why, live, on Nemotron Super. They answer only from their own memory, and cite it. |
| 2:28 | 4 · Explain | Focus group | Or seat six at one table: a focus group, each speaking from their own memory. |
| 2:34 | 5 · Decide | Needed vs reachable | The recommendation: launch A. A live split test would have needed 14,637 people per version, more than everyone on Instagram in this ZIP. Ripple ran it on the simulated crowd, for zero ad spend. |
| 2:47 | 5 · Recommend | Version C, drafted and checked | It also wrote a sharper Version C from the objections. Nemotron Super drafted it, and Nemotron Ultra checked that it invents nothing. |
| 2:54 | 5 · Recommend | C against A, same 600 people | On the same 600 people, C moved intent by one point. Not enough: keep A. |
| 3:00 | 6 · Act, gated | Nothing spends without approval | Launching is gated. Approve builds one paused campaign in Meta Ads. Without Meta keys, it shows the exact requests and sends nothing. |
| 3:08 | 7 · Proof | The unedited agent trace | Every step is in the trace: agents handing off, the critic asking for a revision, and the Nemotron model behind every call. Judges can run it with one curl, no keys needed. |
| 3:18 | Impact | impact | Ripple showed a café how its neighbourhood would react, who stayed silent and why, and lined up the next step for one approval. |
| 3:25 | Cast | cast | Four Nemotron models, each on the job it's best at: Lightning for the crowd, Super for reasoning, Ultra as critic, Nano on a laptop. |
| 3:34 | Close | close | Built with Meterless, Zetaris and NVIDIA Nemotron. Simulated people, not real customers; the limits are on the card. Ripple. |

Total voice plus pauses: about 224 s (3541 characters). The final cut adds cross-fades and is checked to run 3:30 to 4:00.

On-screen honesty rules: every shot of the app is the real app; shots of the saved run `20261027-south-congress-coffe-1458` carry a "saved run" corner label; live shots carry a "live" label; sped-up footage carries a "sped up" chip; nothing shows a credential.
