// Ripple demo video: the single source of truth for the edit.
// Each segment = one voiceover line + the picture under it + its overlays.
// `vo` is what the narrator says (and what docs/pitch/VOICEOVER.md shows); `say` overrides the text
// sent to macOS `say` when pronunciation needs help. `pending: true` segments are skipped by vo/build.
//
// Numbers: only the claim-checked figures for the copy-only demo run 20261027-south-congress-coffe-1458
// (600 people, 2 seeds, 12 rounds, hosted Nemotron 3.5 Lightning via Nightshift, audience queries on Zetaris).
//
// src kinds:
//   { scene: 'intro1', query }                       an HTML page in scripts/video/scenes/, rendered frame by frame
//   { clip: 'create', ranges: [[from, to, speed]] }  a UI recording in media/rec/<clip>/; from/to are seconds or
//                                                    marker names with an optional offset ('receipt_open-4.5')
// overlay: { act, title, badge, live, saved, chip }  drawn by scenes/overlay.html; speed > 1 adds a "sped up" chip

export const VOICE = 'Samantha';   // macOS say fallback
export const RATE = 184;

// ElevenLabs narrator (used per line when the key in .env works; set voiceId to pin a voice)
export const ELEVEN = {
  voiceId: null,
  prefer: ['Brian', 'Sarah', 'Alice', 'Daniel', 'George'],
  model: 'eleven_multilingual_v2',
  settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed: 1.15 },   // speed keeps the cut under 4:00
};

export const BADGES = {
  super: { model: 'Nemotron 3.5 Super 120B', job: 'reasoning', route: 'NVIDIA' },
  lightning: { model: 'Nemotron 3.5 Lightning 30B', job: 'crowd decisions', route: 'Nightshift' },
  ultra: { model: 'Nemotron 3 Ultra 550B', job: 'critic', route: 'Nightshift' },
  nano: { model: 'Nemotron 3 Nano 4B', job: 'laptop run, offline fallback', route: 'local Ollama' },
  hmem: { model: 'Meterless H-MEM', job: 'per-person memory', route: 'Meterless' },
};

const SAVED = '1458 · 600 people · Lightning';

export const SEGMENTS = [
  // ---------------------------------------------------------------- story intro (illustrated)
  { id: 'intro1', src: { scene: 'intro1' }, pad: 0.3,
    vo: "Meet the owner of South Congress Coffee, in Austin. She wrote her new latte post two ways, and wants to know how the neighbourhood will react." },
  { id: 'intro2', src: { scene: 'intro2' }, pad: 0.4,
    vo: "One leads with the product, one tells a story. Which will bring people in, and what will they think?" },
  { id: 'intro3', src: { scene: 'intro3' }, pad: 0.5,
    vo: "Post it, and you only hear the loud few; most scroll past in silence. What if she could watch the neighbourhood react first?",
    say: "Post it, and you only hear the loud few; most scroll past in silence. [[slnc 300]] What if she could watch the neighbourhood react first?" },
  { id: 'logo', src: { scene: 'logo' }, pad: 0.6,

    vo: "This is Ripple. It simulates how the public will react to anything you post — ads, tweets, LinkedIn comments, announcements, statements — and shows you why." },
  { id: 'loop', src: { scene: 'loop' }, pad: 0.2,
    vo: "It's an agent, working in a loop: build the audience, simulate, investigate, explain, recommend." },
  { id: 'agents', src: { clip: 'agents', ranges: [['start', 'end', 1]] }, pad: 0.3,
    overlay: { act: 'The agent', title: 'Uses tools · Critiques itself · Asks permission', saved: SAVED },
    vo: "It uses tools — SQL on its own event log. It critiques and revises itself — a code critic, a model critic, an honesty check. And it asks permission: free, reversible steps go ahead; anything that spends or publishes waits for the owner." },

  // ---------------------------------------------------------------- 1 · create (live: run 20261027-south-congress-coffe-14d8)
  { id: 'create1', src: { clip: 'create', ranges: [['form', 'audience', 5]] }, pad: 0.2,
    overlay: { act: '1 · Build the audience', title: 'A new test, live', live: true },
    vo: "Type the business, the ZIP, the goal, and the post. Here, both drafts.",
    say: "Type the business, the zip, the goal, and the post. Here, both drafts." },
  { id: 'create2', src: { clip: 'create', ranges: [['audience', 'audience+2.5', 1], ['audience_ready-0.3', 'audience_ready+12', 1]] }, pad: 0.2,
    overlay: { act: '1 · Build the audience', title: 'Who to reach, counted on Zetaris', badge: 'super', live: true },
    vo: "An audience agent on Nemotron Super builds the audience from real Census and Pew data — the general public, or a specific demographic. It never guesses how many people exist: a data agent counts them, on Zetaris." },
  { id: 'create3', src: { clip: 'create', ranges: [['launch-0.3', 'launch+2.4', 1], ['run', 'receipts', 16], ['receipt_open-4.6', 'receipt_open+0.4', 1]] }, pad: 0.2,
    overlay: { act: '1 · Build the audience', title: 'Every person has a receipt', live: true },
    vo: "Run it. Every person gets a receipt: the query, the SQL, and the engine that ran it." },
  { id: 'create4', src: { clip: 'create', ranges: [['nemotron+1', 'end', 1]] }, pad: 0.3,
    overlay: { act: '1 · Build the audience', title: 'The model behind every call', badge: 'lightning', live: true },
    vo: 'And every simulated decision runs on Nemotron Lightning, through Nightshift.' },
  { id: 'sources', src: { clip: 'sources', ranges: [['start', 'end', 2]] }, pad: 0.3,
    overlay: { act: '1 · Build the audience', title: 'Five sources, all answered by Zetaris', live: true },
    vo: "Every source carries its licence: public Census and Pew data, labelled behaviour priors, and a customer list that's synthetic in this demo." },

  // ---------------------------------------------------------------- 2 · simulate (saved run 20261027-south-congress-coffe-1458)
  { id: 'crowd', src: { clip: 'crowd', ranges: [['start+1', 'persona+1.2', 1.6], ['receipts-0.3', 'end', 1]] }, pad: 0.2,
    overlay: { act: '2 · Simulate', title: 'The crowd: 600 people in 78704', badge: 'lightning', saved: SAVED },
    vo: "Then it simulates a day of that audience seeing the post: memory, competition, and word of mouth. Here, 600 people, each deciding on Nemotron Lightning." },
  { id: 'worlds', src: { clip: 'worlds', ranges: [['start', 'drawer', 1.25], ['timeline-0.6', 'end', 1]] }, pad: 0.2,
    overlay: { act: '2 · Simulate', title: 'Twin worlds, verified by hash', badge: 'hmem', saved: SAVED },
    vo: "To compare two drafts fairly, it runs an A/B test inside the simulation: two identical worlds, verified by hash, where only the post differs. Each person remembers what they saw, on Meterless H-MEM.",
    say: "To compare two drafts fairly, it runs an A B test inside the simulation: two identical worlds, verified by hash, where only the post differs. Each person remembers what they saw, on Meterless H mem." },
  { id: 'signals', src: { clip: 'signals', ranges: [['start', 'end', 1]] }, pad: 0.2,
    overlay: { act: '2 · Simulate', title: 'The curveball at round 8', badge: 'lightning', saved: SAVED },
    vo: "Mid-morning, a competitor posts 30% off all lattes. It pulled intent down in both worlds.",
    say: "Mid-morning, a competitor posts thirty percent off all lattes. It pulled intent down in both worlds." },

  // ---------------------------------------------------------------- 3 · analyse
  { id: 'verdict', src: { clip: 'verdict', ranges: [['start', 'end', 1]] }, pad: 0.2,
    overlay: { act: '3 · Investigate', title: 'The verdict is computed', saved: SAVED },
    vo: "The verdict is computed, not opinion: A leads on intent to visit, 24.8% to 23.4%, ahead in both seeds, and 70% likely to be the better version.",
    say: "The verdict is computed, not opinion: A leads on intent to visit, 24.8 percent to 23.4, ahead in both seeds, and 70 percent likely to be the better version." },
  { id: 'report', src: { clip: 'report', ranges: [['start', 'critic+2.5', 1], ['flip-3', 'end', 1]] }, pad: 0.3,
    overlay: { act: '3 · Investigate', title: 'Every claim has a receipt', saved: SAVED },
    vo: "Then it investigates — across Census and Pew, its own event log in SQL, and its critics — and reports how each group felt, with the evidence for every reason: customers leaned to A; people earning fifty to seventy-five thousand leaned to B. And it hears who stayed silent: 60 people kept their reaction private, against 13 public comments.",
    say: "Then it investigates — across Census and Pew, its own event log in SQL, and its critics — and reports how each group felt, with the evidence for every reason. Customers leaned to A; people earning fifty to seventy-five thousand leaned to B. And it hears who stayed silent: sixty people kept their reaction private, against thirteen public comments." },

  // ---------------------------------------------------------------- 4 · ask
  { id: 'ask1', src: { clip: 'ask', ranges: [['twin_a-0.6', 'asked-1', 1]] }, pad: 0.2,
    overlay: { act: '4 · Explain', title: 'Same person, two worlds', saved: SAVED },
    vo: "One person, both worlds: the product-first post gave them a reason to try it; the story-first one felt steep for a daily habit." },
  { id: 'ask2', src: { clip: 'ask', ranges: [['asked-1', 'interview_end', 1]] }, pad: 3.6,
    overlay: { act: '4 · Explain', title: 'Interview, live', badge: 'super', live: true },
    vo: 'Ask them why, live, on Nemotron Super. They answer only from their own memory, and cite it.' },
  { id: 'ask3', src: { clip: 'ask', ranges: [['focus_run-0.9', 'focus_run+0.4', 1], ['focus_run+0.4', 'end', 8]] }, pad: 1.2,
    overlay: { act: '4 · Explain', title: 'Focus group', badge: 'super', live: true },
    vo: 'Or seat six at one table: a focus group, each speaking from their own memory.' },

  // ---------------------------------------------------------------- 5 · decide (C vs A: run 20261027-south-congress-coffe-13b7)
  { id: 'decide1', src: { clip: 'decide', ranges: [['start', 'versionc', 1]] }, pad: 0.3,
    overlay: { act: '5 · Recommend', title: 'Launch A, with every reason linked', saved: SAVED },
    vo: "The recommendation: launch A — and every reason behind it links back to the people and the queries it came from." },
  { id: 'decide2', src: { clip: 'decide', ranges: [['versionc', 'versionc+6.5', 1], ['c_result-0.5', 'to_c', 1]] }, pad: 0.4,
    overlay: { act: '5 · Recommend', title: 'Version C, drafted and checked', badge: ['super', 'ultra'], saved: SAVED },
    vo: "It also drafted a sharper Version C on Nemotron Super, and Nemotron Ultra checked it invents nothing." },
  { id: 'decide3', src: { clip: 'decide', ranges: [['c_verdict-0.3', 'end', 1]] }, pad: 0.4,
    overlay: { act: '5 · Recommend', title: 'C against A, same 600 people', badge: 'lightning', saved: '13b7 · Version C vs A · Lightning' },
    vo: "On the same 600 people, C moved intent by one point. Not enough: keep A." },

  // ---------------------------------------------------------------- 6 · act
  { id: 'act', src: { clip: 'act', ranges: [['start', 'start+6', 1.3], ['launch-0.3', 'end-0.5', 1.3]] }, pad: 0.6,
    overlay: { act: '6 · Act, gated', title: 'Nothing spends without approval', live: true },
    vo: "Launching is gated. Approve builds one paused campaign in Meta Ads. Without Meta keys, it shows the exact requests and sends nothing." },

  // ---------------------------------------------------------------- 7 · proof
  { id: 'proof', src: { scene: 'proof' }, pad: 0.4,
    overlay: { act: '7 · Proof', title: 'The unedited agent trace' },
    vo: "Every step is in the trace: agents handing off, the critic asking for a revision, and the Nemotron model behind every call." },

  // ---------------------------------------------------------------- impact + cast + close
  { id: 'impact', src: { scene: 'impact', query: 'lines=' + encodeURIComponent("See how the public reacts, before you post.|Hear the silent majority, and why.|Act only with the owner's approval.") }, pad: 0.4,
    vo: "Ripple showed a café how its neighbourhood would react — who responded, who stayed silent, and why — before posting a thing." },
  { id: 'cast', src: { scene: 'cast' }, pad: 0.5,
    vo: "Four Nemotron models, each on the job it's best at: Lightning for the crowd, Super for reasoning, Ultra as critic, Nano on a laptop." },
  { id: 'close', src: { scene: 'close' }, pad: 1.6,
    vo: 'Built with Meterless, Zetaris and NVIDIA Nemotron. Simulated people, not real customers; the limits are on the card. Ripple.',
    say: 'Built with Meterless, Zetaris, and NVIDIA Nemotron. Simulated people, not real customers; the limits are on the card. [[slnc 300]] Ripple.' },
];

export const TRANSITION = 0.5; // seconds, xfade between segments
