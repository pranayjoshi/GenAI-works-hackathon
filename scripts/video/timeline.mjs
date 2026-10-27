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
  settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true, speed: 1.1 },   // speed keeps the cut under 4:00
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
    vo: 'Meet the owner of South Congress Coffee, in Austin. She wrote the post for her new latte two ways.' },
  { id: 'intro2', src: { scene: 'intro2' }, pad: 0.4,
    vo: 'One leads with the product, one tells a story. Same latte, same price. Which words bring more people in?' },
  { id: 'intro3', src: { scene: 'intro3' }, pad: 0.5,
    vo: 'She could pay for an A/B test. But if the two are too close to call, that money is gone. What if she could rehearse the test first?',
    say: 'She could pay for an A B test. But if the two are too close to call, that money is gone. [[slnc 300]] What if she could rehearse the test first?' },
  { id: 'logo', src: { scene: 'logo' }, pad: 0.6,
    vo: 'This is Ripple. Before you spend a dollar, it asks: can that test even tell these two apart?' },

  // ---------------------------------------------------------------- 1 · create (live: run 20261027-south-congress-coffe-14d8)
  { id: 'create1', src: { clip: 'create', ranges: [['form', 'audience', 5]] }, pad: 0.2,
    overlay: { act: '1 · Create', title: 'A new test, live', live: true },
    vo: 'Type the business, the ZIP, the goal, and both posts: product-first and story-first.',
    say: 'Type the business, the zip, the goal, and both posts: product first, and story first.' },
  { id: 'create2', src: { clip: 'create', ranges: [['audience', 'audience+2.5', 1], ['audience_ready-0.3', 'audience_ready+12', 1]] }, pad: 0.2,
    overlay: { act: '1 · Create', title: 'Who to reach, counted on Zetaris', badge: 'super', live: true },
    vo: 'An audience agent on Nemotron Super names who to reach. It never decides how many people exist: a data agent counts them from Census and Pew, on Zetaris.' },
  { id: 'create3', src: { clip: 'create', ranges: [['launch-0.3', 'launch+2.4', 1], ['run', 'receipts', 16], ['receipt_open-4.6', 'receipt_open+0.4', 1]] }, pad: 0.2,
    overlay: { act: '1 · Create', title: 'Every person has a receipt', live: true },
    vo: 'Run it. The agents go to work, and every person gets a receipt: the query, the exact SQL, and the engine that ran it.' },
  { id: 'create4', src: { clip: 'create', ranges: [['nemotron+1', 'end', 1]] }, pad: 0.3,
    overlay: { act: '1 · Create', title: 'The model behind every call', badge: 'lightning', live: true },
    vo: 'And every simulated decision runs on Nemotron Lightning, through Nightshift.' },
  { id: 'sources', src: { clip: 'sources', ranges: [['start', 'end', 2]] }, pad: 0.3,
    overlay: { act: '1 · Create', title: 'Five sources, all answered by Zetaris', live: true },
    vo: "The crowd comes from four sources, federated through Zetaris: public Census and Pew data, modeled behaviour priors, labelled as such, and the business's customer list, synthetic here." },

  // ---------------------------------------------------------------- 2 · simulate (saved run 20261027-south-congress-coffe-1458)
  { id: 'crowd', src: { clip: 'crowd', ranges: [['start+1', 'persona+1.2', 1.6], ['receipts-0.3', 'end', 1]] }, pad: 0.2,
    overlay: { act: '2 · Simulate', title: 'The crowd: 600 people in 78704', badge: 'lightning', saved: SAVED },
    vo: "For the full test we ran 600 people, on Nemotron Lightning. Each is sampled from real distributions: age, income, Instagram use, customer or not." },
  { id: 'worlds', src: { clip: 'worlds', ranges: [['start', 'drawer', 1.25], ['timeline-0.6', 'end', 1]] }, pad: 0.2,
    overlay: { act: '2 · Simulate', title: 'Twin worlds, verified by hash', badge: 'hmem', saved: SAVED },
    vo: 'Every person lives in two identical worlds, verified by hash; only the post differs. And each one remembers what they saw, on Meterless H-MEM.',
    say: 'Every person lives in two identical worlds, verified by hash; only the post differs. And each one remembers what they saw, on Meterless H mem.' },
  { id: 'signals', src: { clip: 'signals', ranges: [['start', 'end', 1]] }, pad: 0.2,
    overlay: { act: '2 · Simulate', title: 'The curveball at round 8', badge: 'lightning', saved: SAVED },
    vo: "Mid-morning, a competitor across the street posts 30% off all lattes, in both worlds at once. A was already slightly ahead; the competitor's post pulled intent down in both.",
    say: "Mid-morning, a competitor across the street posts thirty percent off all lattes, in both worlds at once. A was already slightly ahead; the competitor's post pulled intent down in both." },

  // ---------------------------------------------------------------- 3 · analyse
  { id: 'verdict', src: { clip: 'verdict', ranges: [['start', 'end', 1]] }, pad: 0.2,
    overlay: { act: '3 · Analyse', title: 'The verdict is code', saved: SAVED },
    vo: "The verdict is code, not a model's opinion: A 24.8%, B 23.4%, inside ±5.1 points. A led in both seeds, and it's still too close to call.",
    say: "The verdict is code, not a model's opinion: A, 24.8 percent. B, 23.4 percent. Inside plus or minus 5.1 points. A led in both seeds, and it's still too close to call." },
  { id: 'report', src: { clip: 'report', ranges: [['start', 'critic+2.5', 1], ['flip-3', 'end', 1]] }, pad: 0.3,
    overlay: { act: '3 · Analyse', title: 'Every claim has a receipt', saved: SAVED },
    vo: 'Every claim cites its query: customers leaned to A; people earning fifty to seventy-five thousand leaned to B. And most stayed silent: 60 people wrote a reaction they kept private, against 13 public comments.',
    say: 'Every claim cites its query. Customers leaned to A; people earning fifty to seventy-five thousand leaned to B. And most stayed silent: sixty people wrote a reaction they kept private, against thirteen public comments.' },

  // ---------------------------------------------------------------- 4 · ask
  { id: 'ask1', src: { clip: 'ask', ranges: [['twin_a-0.6', 'asked-1', 1]] }, pad: 0.2,
    overlay: { act: '4 · Ask', title: 'Same person, two worlds', saved: SAVED },
    vo: 'One person, in both worlds. The product-first post gave them a reason to try it. The story-first one? Six fifty felt steep for a daily habit.',
    say: 'One person, in both worlds. The product first post gave them a reason to try it. The story first one? Six fifty felt steep, for a daily habit.' },
  { id: 'ask2', src: { clip: 'ask', ranges: [['asked-1', 'interview_end', 1]] }, pad: 5.0,
    overlay: { act: '4 · Ask', title: 'Interview, live', badge: 'super', live: true },
    vo: 'Ask them why, live, on Nemotron Super. They answer only from their own memory, and cite it.' },
  { id: 'ask3', src: { clip: 'ask', ranges: [['focus_run-0.9', 'focus_run+0.4', 1], ['focus_run+0.4', 'focus_run+280', 40]] }, pad: 1.2,
    overlay: { act: '4 · Ask', title: 'Focus group', badge: 'super', live: true },
    vo: 'Or seat six of them at one table, a focus group, where each person speaks from their own memory.' },

  // ---------------------------------------------------------------- 5 · decide (C vs A: run 20261027-south-congress-coffe-13b7)
  { id: 'decide1', src: { clip: 'decide', ranges: [['start', 'versionc', 1]] }, pad: 0.3,
    overlay: { act: '5 · Decide', title: 'Needed vs reachable', saved: SAVED },
    vo: "Here's the decision. To tell these two apart, a real test needs 14,637 people per version: more than everyone on Instagram in this ZIP. A test she can afford only detects a 3.4-point gap. So: don't pay for this test.",
    say: "Here's the decision. To tell these two apart, a real test needs 14,637 people per version: more than everyone on Instagram in this zip. A test she can afford only detects a 3.4 point gap. So: don't pay for this test." },
  { id: 'decide2', src: { clip: 'decide', ranges: [['versionc', 'versionc+6.5', 1], ['c_result-0.5', 'to_c', 1]] }, pad: 0.4,
    overlay: { act: '5 · Decide', title: 'Version C, drafted and checked', badge: ['super', 'ultra'], saved: SAVED },
    vo: 'So Ripple wrote a Version C from what people said. Nemotron Super drafted it, and Nemotron Ultra checked that it invents nothing.' },
  { id: 'decide3', src: { clip: 'decide', ranges: [['c_verdict-0.3', 'end', 1]] }, pad: 0.4,
    overlay: { act: '5 · Decide', title: 'C against A, same 600 people', badge: 'lightning', saved: '13b7 · Version C vs A · Lightning' },
    vo: 'Then it ran C against A on the same 600 people. C moved intent by one point, well below what an affordable test can detect. Keep A, keep the money.' },

  // ---------------------------------------------------------------- 6 · act
  { id: 'act', src: { clip: 'act', ranges: [['start', 'start+6', 1.3], ['launch-0.3', 'end-0.5', 1.3]] }, pad: 0.6,
    overlay: { act: '6 · Act', title: 'Nothing spends without approval', live: true },
    vo: "Anything that spends money waits for the owner. Ripple advises against this test, but if she still wants it, Approve builds a paused Meta Ads campaign. Without Meta keys, it shows the exact requests and sends nothing." },

  // ---------------------------------------------------------------- 7 · proof
  { id: 'proof', src: { scene: 'proof' }, pad: 0.4,
    overlay: { act: '7 · Proof', title: 'The unedited agent trace' },
    vo: 'Every step is in the trace: agents handing off, the critic asking for a revision, and the Nemotron model behind every call. Judges can run it with one curl, no keys needed.' },

  // ---------------------------------------------------------------- impact + cast + close
  { id: 'impact', src: { scene: 'impact', query: 'lines=' + encodeURIComponent("Don't pay for a test that can't find a winner.|Hear why, in the crowd's own words.|The next step waits for one click.") }, pad: 0.4,
    vo: "Ripple told a café not to pay for a test it couldn't win, showed why in the crowd's own words, and lined up the next step for one click." },
  { id: 'cast', src: { scene: 'cast' }, pad: 0.5,
    vo: "Four Nemotron models, each on the job it's best at: Lightning for the crowd, Super for reasoning, Ultra as critic, Nano on a laptop." },
  { id: 'close', src: { scene: 'close' }, pad: 2.0,
    vo: 'Built with Meterless, Zetaris and NVIDIA Nemotron. Simulated people, not real customers; the limits are on the card. Ripple.',
    say: 'Built with Meterless, Zetaris, and NVIDIA Nemotron. Simulated people, not real customers; the limits are on the card. [[slnc 300]] Ripple.' },
];

export const TRANSITION = 0.5; // seconds, xfade between segments
