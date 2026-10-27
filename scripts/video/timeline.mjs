// Ripple demo video: the single source of truth for the edit.
// Each segment = one voiceover line + the picture under it + its overlays.
// `vo` is what the narrator says (and what docs/pitch/VOICEOVER.md shows); `say` overrides the text
// sent to macOS `say` when pronunciation needs help. Numbers come from docs/pitch/DEMO_PLAN.md (claim-checked).
//
// src kinds:
//   { scene: 'intro', from, to }        an HTML scene page in scripts/video/scenes/<name>.html, rendered frame by frame
//   { clip: 'create', from: 'mark', to: 'mark', speed }   a UI recording (media/rec/<clip>/) between two markers
//
// overlay: { act, title, badge, saved, chip }  (drawn by scripts/video/overlay.html into a transparent PNG)

export const VOICE = 'Samantha';
export const RATE = 178;

export const BADGES = {
  super: { model: 'Nemotron 3.5 Super 120B', job: 'reasoning', route: 'NVIDIA' },
  lightning: { model: 'Nemotron 3.5 Lightning 30B', job: 'crowd decisions', route: 'Nightshift' },
  ultra: { model: 'Nemotron 3 Ultra 550B', job: 'critic', route: 'Nightshift' },
  nano: { model: 'Nemotron 3 Nano 4B', job: '600-person run, laptop', route: 'local Ollama' },
  hmem: { model: 'Meterless H-MEM', job: 'per-person memory', route: 'Meterless' },
};

export const SEGMENTS = [
  // ---------------------------------------------------------------- story intro (illustrated)
  { id: 'intro1', src: { scene: 'intro1' }, pad: 0.4,
    vo: 'Meet the owner of South Congress Coffee, in Austin. She wrote the post for her new latte two ways.' },
  { id: 'intro2', src: { scene: 'intro2' }, pad: 0.5,
    vo: 'One leads with the product. One tells a story. Same latte, same price. Which words bring more people in?' },
  { id: 'intro3', src: { scene: 'intro3' }, pad: 0.6,
    vo: 'She could pay for an A/B test. But if the two are too close to tell apart, that money is gone. What if she could rehearse the test first?',
    say: 'She could pay for an A B test. But if the two are too close to tell apart, that money is gone. [[slnc 350]] What if she could rehearse the test first?' },
  { id: 'logo', src: { scene: 'logo' }, pad: 0.7,
    vo: 'This is Ripple. Before you spend a dollar, it asks a better question: can that test even tell these two apart?' },

  // ---------------------------------------------------------------- 1 · create (live, run 20261027-south-congress-coffe-bc40)
  { id: 'create1', src: { clip: 'create', ranges: [['form', 'audience', 2.5]] }, pad: 0.2,
    overlay: { act: '1 · Create', title: 'A new test, live', live: true },
    vo: 'It starts the way any test would. Type the business, the ZIP, the goal, and both posts: product-first and story-first.',
    say: 'It starts the way any test would. Type the business, the zip, the goal, and both posts: product first, and story first.' },
  { id: 'create2', src: { clip: 'create', ranges: [['audience', 'audience+3', 1], ['audience_ready-0.3', 'audience_ready+12.5', 1]] }, pad: 0.2,
    overlay: { act: '1 · Create', title: 'Who to reach, counted on Zetaris', badge: 'super', live: true },
    vo: 'An audience agent on Nemotron Super names who to reach. But it never decides how many people exist: a data agent counts them from Census and Pew, with SQL that runs on Zetaris.' },
  { id: 'create3', src: { clip: 'create', ranges: [['launch-0.5', 'run+3', 1], ['run+3', 'receipts', 12], ['receipt_open-5.5', 'receipt_open+2.5', 1]] }, pad: 0.2,
    overlay: { act: '1 · Create', title: 'Every person has a receipt', live: true },
    vo: 'Run it. The agents go to work, and every person in the crowd gets a receipt: the query id, the exact SQL, and the engine that ran it.' },
  { id: 'create4', src: { clip: 'create', ranges: [['nemotron+1', 'end-3', 1]] }, pad: 0.3,
    overlay: { act: '1 · Create', title: 'The model behind every call', badge: 'lightning', live: true },
    vo: 'And behind every call, the model that answered: each simulated decision runs on Nemotron Lightning, through Nightshift.' },

  // ---------------------------------------------------------------- data sources (illustrated)
  { id: 'sources1', src: { scene: 'sources' }, pad: 0.4,
    vo: "The crowd comes from four sources, federated through Zetaris: Census survey data and Pew's Instagram use by age, both public; behaviour priors, modeled and labelled as such; and the business's customer list, synthetic in this demo.",
    say: "The crowd comes from four sources, federated through Zetaris: Census survey data and Pew's Instagram use by age, both public. Behaviour priors, modeled, and labelled as such. And the business's customer list, synthetic in this demo." },
  { id: 'sources2', src: { clip: 'sources', ranges: [['start', 'end', 2]] }, pad: 0.4,
    overlay: { act: '1 · Create', title: 'Five sources, all answered by Zetaris', live: true },
    vo: 'In the app, every source carries its licence, the engine that served it and its query ids, down to the one join that sizes the local Instagram audience. Real Upworthy A/B tests back the backtest.',
    say: 'In the app, every source carries its licence, the engine that served it, and its query ids, down to the one join that sizes the local Instagram audience. Real Upworthy A B tests back the backtest.' },

  // ---------------------------------------------------------------- 3 · simulate (saved 600-person run)
  { id: 'crowd', pending: true, src: { clip: 'crowd', from: 'start', to: 'end' }, pad: 0.4,
    overlay: { act: '2 · Simulate', title: 'The crowd: 600 people in 78704', badge: 'nano', saved: 'e52a · 600 people · Nano 4B' },
    vo: 'For the full test we ran 600 people in this ZIP. Each one is sampled from real distributions: age, income, how often they use Instagram, whether they are already a customer.' },
  { id: 'worlds', pending: true, src: { clip: 'worlds', from: 'start', to: 'end' }, pad: 0.4,
    overlay: { act: '2 · Simulate', title: 'Twin worlds, verified by hash', badge: 'hmem', saved: 'e52a · 600 people · Nano 4B' },
    vo: 'Every person lives in two identical worlds. Same people, same follows, same day, verified by hash. The only difference is the post. Each person remembers what they saw, on the Meterless H-MEM memory engine.',
    say: 'Every person lives in two identical worlds. Same people, same follows, same day, verified by hash. The only difference is the post. Each person remembers what they saw, on the Meterless H mem memory engine.' },
  { id: 'signals', pending: true, src: { clip: 'signals', from: 'start', to: 'end' }, pad: 0.4,
    overlay: { act: '2 · Simulate', title: 'The curveball at round 8', badge: 'nano', saved: 'e52a · 600 people · Nano 4B' },
    vo: 'Mid-morning, a competitor across the street posts 30% off all lattes. It reaches both worlds at the same moment. Before it, A and B were tied, 35.3 to 35.6. The gap opened after.',
    say: 'Mid-morning, a competitor across the street posts thirty percent off all lattes. It reaches both worlds at the same moment. Before it, A and B were tied, 35.3 to 35.6. The gap opened after.' },

  // ---------------------------------------------------------------- 4 · analyse
  { id: 'verdict', pending: true, src: { clip: 'verdict', from: 'start', to: 'end' }, pad: 0.4,
    overlay: { act: '3 · Analyse', title: 'The verdict is code', saved: 'e52a · 600 people · Nano 4B' },
    vo: "The verdict is code, not a model's opinion: A 29.6%, B 26.7%, inside ±5.5 points. Too close to call.",
    say: "The verdict is code, not a model's opinion: A, 29.6 percent. B, 26.7 percent. Inside plus or minus 5.5 points. Too close to call." },
  { id: 'report', pending: true, src: { clip: 'report', from: 'start', to: 'end' }, pad: 0.5,
    overlay: { act: '3 · Analyse', title: 'Every number has a receipt', badge: 'ultra', saved: 'e52a · 600 people · Nano 4B' },
    vo: "The report cites a query for every number, and a critic on Nemotron Ultra checks it and sends it back when a number doesn't match. And 874 people reacted but said nothing in public; only 68 commented. Ripple hears the silent ones." },

  // ---------------------------------------------------------------- 5 · ask (phase 2)
  { id: 'ask', pending: true, phase: 2, src: { clip: 'ask', from: 'start', to: 'end' }, pad: 0.5,
    overlay: { act: '4 · Ask', title: 'Interview one person', badge: 'super', live: true },
    vo: 'Ask anyone why. Person p0176, in world A: why did you scroll past the oat milk honey latte post? They answer only from their own memory of the day. No invented backstory.',
    say: 'Ask anyone why. Person p, zero one seven six, in world A: why did you scroll past the oat milk honey latte post? [[slnc 2500]] They answer only from their own memory of the day. No invented backstory.' },

  // ---------------------------------------------------------------- 6 · decide (phase 2)
  { id: 'decide1', pending: true, phase: 2, src: { clip: 'decide', from: 'start', to: 'versionc' }, pad: 0.3,
    overlay: { act: '5 · Decide', title: 'Needed vs reachable', saved: 'e52a · 600 people · Nano 4B' },
    vo: "Here's the decision. To tell these posts apart, a real test needs 3,828 people per version: 28% of everyone on Instagram in this ZIP. A test she can afford only detects a 3.5-point gap. So: don't pay for this test.",
    say: "Here's the decision. To tell these posts apart, a real test needs 3,828 people per version: 28 percent of everyone on Instagram in this zip. A test she can afford only detects a 3.5 point gap. So: don't pay for this test." },
  { id: 'decide2', pending: true, phase: 2, src: { clip: 'decide', from: 'versionc', to: 'end' }, pad: 0.5,
    overlay: { act: '5 · Decide', title: 'Version C, checked and tested', badge: 'ultra', saved: '344c · Version C vs A · Lightning' },
    vo: 'Instead, Ripple drafted Version C from the price objections, Nemotron Ultra checked it invents no new claims, and one click ran C against A on the same crowd, through Nightshift: C moved intent 1.1 points. Not enough. Keep A, save the money.' },

  // ---------------------------------------------------------------- 7 · act (phase 2)
  { id: 'act', pending: true, phase: 2, src: { clip: 'act', from: 'start', to: 'end' }, pad: 0.6,
    overlay: { act: '6 · Act', title: 'Nothing spends without approval', live: true },
    vo: 'Free, reversible steps already ran. Anything that spends money waits for the owner. Approve, and Ripple builds the campaign in Meta Ads: two ad sets, identical targeting, a fixed daily budget, every object created paused. Without Meta keys, it shows the exact requests and sends nothing.' },

  // ---------------------------------------------------------------- 8 · proof
  { id: 'proof', src: { scene: 'proof' }, pad: 0.6,
    overlay: { act: '7 · Proof', title: 'The unedited agent trace' },
    vo: 'Every step is in the trace: named agents handing off, the critic asking for a revision, every Zetaris query, and the Nemotron model behind every request. Lightning and Ultra through Nightshift, Super for reasoning. Judges can run the same thing with one curl, even with no keys.' },

  // ---------------------------------------------------------------- 9 · impact + cast + close
  { id: 'impact', pending: true, src: { scene: 'impact' }, pad: 0.5,
    vo: "Ripple told a café not to spend money on a test it couldn't win, showed why in its customers' own words, and set up the next step for one click." },
  { id: 'cast', src: { scene: 'cast' }, pad: 0.6,
    vo: 'Four Nemotron models, each doing the job it is best at. Lightning for every simulated decision. Super for reasoning. Ultra as the critic. And Nano for the full run on a laptop.' },
  { id: 'close', src: { scene: 'close' }, pad: 2.6,
    vo: 'Built with Meterless Nightshift and H-MEM, Zetaris, and NVIDIA Nemotron. Simulated people, not real customers, and the limits are on the card. Ripple.',
    say: 'Built with Meterless Nightshift and H mem, Zetaris, and NVIDIA Nemotron. Simulated people, not real customers, and the limits are on the card. [[slnc 300]] Ripple.' },
];

export const TRANSITION = 0.5; // seconds, xfade between segments that change picture
