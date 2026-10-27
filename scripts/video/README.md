# Demo video pipeline

Builds `media/ripple-demo.mp4` (1920x1080, 30 fps, H.264 + AAC) from the real app, illustrated HTML scenes and a macOS `say` voiceover. Everything under `media/` is a build output and is git-ignored.

## One command (from recordings already on disk)

```bash
bash scripts/video/make.sh
```

That renders the voiceover (`vo.mjs`), assembles the cut (`build.mjs`) and verifies it (`check.mjs`: duration 3:30 to 4:00, audio/video length, black frames, credential grep, one review frame per segment in `media/frames/`, thumbnail).

## Files

| File | What |
|---|---|
| `timeline.mjs` | The edit: every segment's voiceover line, picture source, cut ranges and overlay (act caption, Nemotron badge, LIVE / SAVED RUN label, "sped up" chip). `pending: true` segments are skipped. |
| `vo.mjs` | `say -v Samantha` per line, measured with ffprobe; writes `docs/pitch/VOICEOVER.md`. |
| `rec-create.mjs` | Films the live beat: New test form, audience proposal, run, query receipt, Nemotron panel. |
| `rec-saved.mjs` | Films the stage beats of a finished run (`RUN=<id> node scripts/video/rec-saved.mjs crowd worlds ...`). |
| `lib/recorder.mjs` | CDP screencast capture (JPEG frames with timestamps to CFR 30 fps), visible cursor with click ripple, eased moves, smooth scrolls, markers. |
| `render-scene.mjs` | Renders `scenes/*.html` frame by frame (animations paused and seeked), so scenes are deterministic and exactly as long as their line. |
| `scenes/` | Story intro, logo, data sources, proof terminal (the real trace command output, injected at build time), impact, cast, close, overlay, thumbnail. |
| `build.mjs` | Cuts, overlays, xfades, voice placement, synthesized pad (about -28 LUFS), loudness normalisation. |
| `check.mjs` | Verification and frame export. |

## Recording setup

Playwright lives in `media/tools` (its own `package.json`, `playwright@1.64.1`, which uses Chromium 1248), not in the project's dependencies. Record against a separate server that cannot touch the real ad account or the committed runs:

```bash
cp -R runs media/runs-rec   # once
for v in $(grep -o '^META_[A-Z_]*' .env); do export $v=; done
RUNS_DIR=$PWD/media/runs-rec PORT=8790 npx tsx src/api.ts
```

Never film `.env`, a terminal environment dump, or Nightshift's Console/Providers pages.
