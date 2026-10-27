# Ripple demo video: voiceover script

Generated from `scripts/video/timeline.mjs` by `node scripts/video/vo.mjs`. Voice: ElevenLabs (Brian - Deep, Resonant and Comforting, `eleven_multilingual_v2`), falling back to macOS `say -v Samantha` per line.
Numbers are the claim-checked figures of the copy-only demo run `20261027-south-congress-coffe-1458` (600 people, 2 seeds, 12 rounds, Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris). Start times are approximate.

| Start | Act | On screen | Voiceover |
|---|---|---|---|
| 0:00 | Story | intro1 | Meet the owner of South Congress Coffee, in Austin. She wrote her new latte post two ways, and wants to know how the neighbourhood will react. |
| 0:07 | Story | intro2 | One leads with the product, one tells a story. Which will bring people in, and what will they think? |
| 0:12 | Story | intro3 | Post it, and you only hear the loud few; most scroll past in silence. What if she could watch the neighbourhood react first? |
| 0:20 | Title | logo | This is Ripple. It simulates how the public will react to anything you post — ads, tweets, LinkedIn comments, announcements, statements — and shows you why. |
| 0:29 |  | loop | It's an agent, working in a loop: build the audience, simulate, investigate, explain, recommend. |
| 0:35 | The agent | Uses tools · Critiques itself · Asks permission | It uses tools — SQL on its own event log. It critiques and revises itself — a code critic, a model critic, an honesty check. And it asks permission: free, reversible steps go ahead; anything that spends or publishes waits for the owner. |
| 0:50 | 1 · Build the audience | A new test, live | Type the business, the ZIP, the goal, and the post. Here, both drafts. |
| 0:54 | 1 · Build the audience | Who to reach, counted on Zetaris | An audience agent on Nemotron Super builds the audience from real Census and Pew data — the general public, or a specific demographic. It never guesses how many people exist: a data agent counts them, on Zetaris. |
| 1:06 | 1 · Build the audience | Every person has a receipt | Run it. Every person gets a receipt: the query, the SQL, and the engine that ran it. |
| 1:12 | 1 · Build the audience | The model behind every call | And every simulated decision runs on Nemotron Lightning, through Nightshift. |
| 1:15 | 1 · Build the audience | Five sources, all answered by Zetaris | Every source carries its licence: public Census and Pew data, labelled behaviour priors, and a customer list that's synthetic in this demo. |
| 1:23 | 2 · Simulate | The crowd: 600 people in 78704 | Then it simulates a day of that audience seeing the post: memory, competition, and word of mouth. Here, 600 people, each deciding on Nemotron Lightning. |
| 1:32 | 2 · Simulate | Twin worlds, verified by hash | To compare two drafts fairly, it runs an A/B test inside the simulation: two identical worlds, verified by hash, where only the post differs. Each person remembers what they saw, on Meterless H-MEM. |
| 1:44 | 2 · Simulate | The curveball at round 8 | Mid-morning, a competitor posts 30% off all lattes. It pulled intent down in both worlds. |
| 1:49 | 3 · Investigate | The verdict is computed | The verdict is computed, not opinion: A leads on intent to visit, 24.8% to 23.4%, ahead in both seeds, and 70% likely to be the better version. |
| 1:59 | 3 · Investigate | Every claim has a receipt | Then it investigates — across Census and Pew, its own event log in SQL, and its critics — and reports how each group felt, with the evidence for every reason: customers leaned to A; people earning fifty to seventy-five thousand leaned to B. And it hears who stayed silent: 60 people kept their reaction private, against 13 public comments. |
| 2:20 | 4 · Explain | Same person, two worlds | One person, both worlds: the product-first post gave them a reason to try it; the story-first one felt steep for a daily habit. |
| 2:27 | 4 · Explain | Interview, live | Ask them why, live, on Nemotron Super. They answer only from their own memory, and cite it. |
| 2:36 | 4 · Explain | Focus group | Or seat six at one table: a focus group, each speaking from their own memory. |
| 2:41 | 5 · Decide | Needed vs reachable | The recommendation: launch A — and every reason behind it links back to the people and the queries it came from. |
| 2:46 | 5 · Recommend | Version C, drafted and checked | It also drafted a sharper Version C on Nemotron Super, and Nemotron Ultra checked it invents nothing. |
| 2:52 | 5 · Recommend | C against A, same 600 people | On the same 600 people, C moved intent by one point. Not enough: keep A. |
| 2:57 | 6 · Act, gated | Nothing spends without approval | Launching is gated. Approve builds one paused campaign in Meta Ads. Without Meta keys, it shows the exact requests and sends nothing. |
| 3:04 | 7 · Proof | The unedited agent trace | Every step is in the trace: agents handing off, the critic asking for a revision, and the Nemotron model behind every call. |
| 3:11 | Impact | impact | Ripple showed a café how its neighbourhood would react — who responded, who stayed silent, and why — before posting a thing. |
| 3:18 | Cast | cast | Four Nemotron models, each on the job it's best at: Lightning for the crowd, Super for reasoning, Ultra as critic, Nano on a laptop. |
| 3:27 | Close | close | Built with Meterless, Zetaris and NVIDIA Nemotron. Simulated people, not real customers; the limits are on the card. Ripple. |

Total voice plus pauses: about 216 s (3650 characters). The final cut adds cross-fades and is checked to run 3:30 to 4:00.

On-screen honesty rules: every shot of the app is the real app; shots of the saved run `20261027-south-congress-coffe-1458` carry a "saved run" corner label; live shots carry a "live" label; sped-up footage carries a "sped up" chip; nothing shows a credential.
