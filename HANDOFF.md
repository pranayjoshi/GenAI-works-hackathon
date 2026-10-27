# Hand-off: what's done, what's left (27 Oct 2026, 21:20 UTC)

Submissions close **27 Oct 23:45 UTC** (hard). Plan to submit by **22:30 UTC**.

## 1. Remaining steps, in order

1. **Get the video: it is FINAL.** The GitHub release `demo-video` has `ripple-demo.mp4`: 3:54, 1920x1080, 30 fps, H.264/AAC, about 58 MB, rendered about 21:20 UTC. It covers all seven acts on the new copy-only run:
   - an illustrated story intro;
   - Create (live), Simulate, Analyse, Ask (live interview and focus group), Decide (with the Version C check), Act (Instagram ad previews and paused approval);
   - Proof (the real trace);
   - an impact and Nemotron cast card.

   Automated checks passed: duration, A/V sync, no black frames, no credential strings, −14.8 LUFS. The voice is macOS Samantha. Watch it once before uploading. `media-rec.zip` in the same release holds the UI clips for re-rendering.
2. **Make the repo public:** GitHub → Settings → General → Change visibility → Public. Then open the README in a private window to check.
3. **Upload the video** (YouTube unlisted or Drive "anyone with link"). Test the link in a private browser window.
4. **Slides:** turn `docs/pitch/DECK.md` (12 slides) into a deck. Use screenshots from `docs/images/` and `media/frames/`; the frames are in the release zip.
5. **Submission form:**
   - Track 2 (The Agent That Can Explain Why). Repositioned from Track 3 on branch `rebrand/explain-why`.
   - Repo URL, video link, deck.
   - Sponsor explanation: paste from `docs/SPONSOR_TECH.md`.
   - **Declare pre-existing components:** the vendored Meterless engines in `engines/` (upstream commit 1742dec, 19 Oct; see `engines/VENDORED_FROM.txt`).
   - **Check the team roster**: it locks when the first submission is created.

## 2. State of the project (all committed and pushed)

- **The video is out of date.** Release `demo-video` was rendered BEFORE the product changes (commits 7f926cb, 034a216, 9b32d90) and still shows "too close to call" and "don't pay" wording in the Verdict and Decide scenes. Options: (a) submit it as is, or (b) re-record the Verdict + Decide scenes (dark theme, run 1458) and re-render with `bash scripts/video/make.sh` (about 30-40 minutes). `docs/pitch/VOICEOVER.md` still carries the old wording too.
- **New since the video:** Ripple is the A/B test (leader/winner verdict with CI and P(better); one paused launch); platforms (instagram, facebook, tiktok, youtube, x, reddit); version types post/image/ad/campaign (VisionAgent); places outside the US (World Bank, 6th federated source). Details in README and `docs/SPONSOR_TECH.md`.
- **Zetaris:** tables must be re-registered on a new machine with `scripts/zetaris-register.sh` (`ZETARIS_DB=dryrun2` or a new name). World Bank tables are `dryrun2.*`.

- **Product:** Ripple (formerly Dry Run): simulates how the public will react to what you post, and shows you why. The UI is at `npm start` → http://localhost:8787. The judge API is `POST /run` (Docker on port 8000; see README).
- **Headline demo run:** `runs/20261027-south-congress-coffe-1458`. A copy-only A/B (same latte, same $6.50, only the wording differs).
  - 600 simulated people, 2 seeds, 12 rounds, with a competitor post at round 8.
  - Crowd on Nemotron 3.5 Lightning via Meterless Nightshift; reasoning on Nemotron Super via direct NVIDIA (Nightshift excludes Super VL); review on Ultra via Nightshift.
  - All 7 audience queries ran on Zetaris.
  - Verdict: "A leads on intent to visit: 24.8% vs 23.4% (+1.4 pts, 95% CI −3.7 to +6.5); A ahead in 2 of 2 seeds; 70% likely to be the better version."
  - Decision: "Launch A: it leads by 1.4 points and is 70% likely to be the better version. A sharper Version C could widen the gap." A live split test would need 29,274 people (14,637 per version, 108% of the ZIP's 27,006 Instagram users) and paid impressions. Ripple ran it on the simulated crowd for $0 of ad spend.
- **Version C check:** `runs/20261027-south-congress-coffe-13b7`. C 30.1% vs A 29.0%, +1.0 pt, below the bar, so keep A. The honesty check passed (Ultra via Nightshift).
- **Claim-checked numbers** for the voiceover, deck and Q&A: `docs/pitch/DEMO_PLAN.md` (numbers sheet), `docs/pitch/JUDGE_QA.md`, `docs/pitch/DECK.md`, `docs/SPONSOR_TECH.md`, `samples/README-runs.md`.
- **Voiceover text:** `docs/pitch/VOICEOVER.md`. The video pipeline is in `scripts/video/`.
- **Checks:**
  - `npm test` (all pass).
  - `bash scripts/smoke.sh` (offline replay, SMOKE OK).
  - Docker sample mode with no keys verified (`output_examples/`).
  - Live Nightshift + Zetaris trace in `output_examples/hosted/`.
- **README:** the latest README rewrite (hero image, badges, screenshots in `docs/images/`) came from another session. I committed it as-is. Give it one read for accuracy against `docs/pitch/DEMO_PLAN.md`'s numbers sheet.

## 3. Re-rendering the video (only if you want changes, e.g. the ElevenLabs voice)

Needs a Mac with Node 20, ffmpeg (`brew install ffmpeg`), Nightshift running, the Zetaris bundle up, and `.env` filled from `.env.example`.

1. Download `media-rec.zip` from the release and unzip it into `media/` (it creates `media/rec/`).
2. Start a recording server that cannot touch Meta or the committed runs:

```bash
cp -R runs media/runs-rec
```

```bash
for v in $(grep -o '^META_[A-Z_]*' .env); do export $v=; done; RUNS_DIR=$PWD/media/runs-rec PORT=8790 npx tsx src/api.ts
```

3. (Only if re-recording) Record the Decide and Act scenes on run `20261027-south-congress-coffe-1458` in the **dark theme**. The recording scripts are in `scripts/video/` (see `rec-saved.mjs`).
   - **Decide:** the Spend gate stage (29,274 needed vs 27,006 reachable), then the suggested rewrite (C) and the C result (+1.0 pt, keep A).
   - **Act:** the "How A vs C would look in people's feeds" Instagram mockups. Toggle Feed/Story, click to enlarge, then Approve → "Preview — nothing sent".
4. Rebuild with `bash scripts/video/make.sh`, then check that the duration is still under 4:00.
5. **ElevenLabs voice (optional).** The pipeline uses `ELEVENLABS_API_KEY` from `.env` when it works, and falls back to the macOS voice.
   - The key in the current `.env` was rejected (401 Invalid API key).
   - To use it: create a new key in ElevenLabs (Text to Speech + Voices read) and put it in `.env`. Never paste it anywhere else.
   - If you do use it, add "Voiceover: ElevenLabs" to the end card.

## 4. Cautions

- **Never show on screen or commit:** `.env`, the Nightshift Console/Providers tabs, or any key.
- **Meta is configured in `.env`.** Clicking Approve on a normal server creates real PAUSED objects in the ad account. Record only with `META_*` emptied (the command above).
- **`samples/recordings.sqlite`:** a live run overwrites recordings in it. It's committed in its current state.
- **Zetaris speed:** under Rosetta, a new ZIP's first Zetaris query can take about a minute. Stick to ZIP 78704 for live demos.
- **Wording:** say "simulated people", never "predicts customers". The competitor post's effect is timing only, not causal. The Meta launch is "two paused ad sets with identical targeting", not Meta's split-test object.

## 5. Track 2 rebrand notes (branch `rebrand/explain-why`)

- **README illustrations are new:** `docs/images/hero.jpg` (new tagline), `loop.jpg` (the agent loop) and `evidence.jpg` (one reason traced to its quote, action, query and data). They are rendered from `docs/images/src/*.html` with `bash scripts/render-images.sh` (headless Chrome + ffmpeg). Every number and id in them comes from run 1458's `summary.json` and `actions.sqlite`; change the HTML and re-render if the headline run changes.
- **UI screenshots are older:** `docs/images/{sources,crowd,worlds,signals,report,ask}.jpg` still show the old stage names (Crowd, Twin worlds, Verdict, Ask why). Re-capture them from run 1458 if there is time; the README captions already use the new names.
- **LinkedIn:** the tagline names "LinkedIn comments" as an example of content, but LinkedIn is not a platform option (no Pew data). The README says so under "Where this goes".
