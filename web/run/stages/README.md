# Run stages

The run view (`web/run/workspace.js`) is a workspace with a stage dock. Each stage is one ES module here,
lazy-loaded the first time it is opened and kept alive (hidden) afterwards.

```js
export default {
  id: 'worlds',
  mount(el, ctx) {           // el = an empty .ws-pane; build everything inside it
    const off = ctx.bus.on('action', ({ record, live }) => { ... });
    return {
      show() {},             // pane became visible (resume 3D, re-measure)
      hide() {},             // pane hidden (pause heavy work)
      destroy() { off(); },  // run view closed: dispose three.js, timers, listeners
    };
  },
};
```

## ctx

| field | what |
| --- | --- |
| `S` | run state (spec, status, phase, detail, personas, pmap, sample, proposal, rec[world_id], timeline[world_id][round], counters[world_id], events, usage Map(role|model -> {role, model, calls, tin, tout, ms, errors, served}), traceLog (newest first, 40), verdict, tipping, validity, fairness, report, focus, replay, replayLim, seed, speed, summaries, worlds) |
| `bus.on(type, fn)` | returns `off`. Types below. |
| `worldIds()` / `variants()` | world ids for the current seed (`s1:A`, `s1:B`) and the variants (`A`, `B`) |
| `hourOfRound(r)` | "Day 1 09:00" |
| `go(stageId)` | switch stage |
| `setBadge(stageId, text, pulse)` | badge on the dock |
| `refetch()` | reload the snapshot (emits `snapshot`) |
| `startReplay()` / `stopReplay()` | replay a finished run round by round |
| `setSeed(seed)` | switch seed (emits `seed`) |
| `addEvent(ev)` | record an injected event (emits `event`) |
| `FEED_CAP` | 150 records kept per world |

## bus events

| type | payload | when |
| --- | --- | --- |
| `snapshot` | S | first connect and after every refetch (verdict, done) |
| `status` | {phase, detail} | pipeline phase changes: data, audience, sampling, voices, running, analyzing, report, done |
| `crowd` | personas | crowd sampled |
| `action` | {record, live} | one decision (already pushed to S.rec) |
| `history` | - | S.rec replaced in bulk (history load, replay stop) |
| `round` | {world_id, counters, done} | a world finished a round (S.timeline / S.counters updated) |
| `event` | event | an event was injected |
| `verdict` | verdict | verdict computed (S refetched) |
| `report` | report | report written |
| `trace` | {role, model, served_by, ms, tokens_in, tokens_out, ok, tag} | every model call (S.usage updated) |
| `focus` | turn | one focus-group turn |
| `replay` | {on, round} | replay progress (S.replayLim = round) |
| `seed` | seed | seed switched |
| `stream` | 'live' / 'reconnecting' / 'closed' | SSE state |
| `done`, `error` | - / message | run finished / failed |

Model roles in traces: `crowd` (each simulated person's decision), `voice` (persona voice lines), `reason`
(audience agent, analyst/report agent, rewriter), `review` (critic, honesty check), `interview` (interviews, focus group).

## Shared kit

- `core/dom.js`: `h`, `s`, `mount`, `pct`, `num`, `fmtInt`, `avatar`, `actPill`, `reasonLines`, `variantChip`, `vcolor`, `roundTime`, `cssVar`
- `core/ui.js`: `toast(msg, bad, {label, onclick})`, `openModal`, `openQuery`, `qidChip`, `openAgent(id, {world})`
- `core/api.js`: `api(path, {method, body})`, `fail`
- `core/motion.js`: `countUp`, `stagger`, `reveal`, `tilt`, `magnetic`, `typeText`, `riseWords`, `reduced`, `EASE`
- `core/three-kit.js`: `createStage(host, {camera, controls})` -> `{THREE, scene, camera, onFrame, pick, dispose}` or null without WebGL; `dotTexture`
- Tokens in `css/theme.css`: `--a` / `--b` are the two versions, `--accent`, `--good/--warn/--bad`, `--panel`, `--line`, eases `--ease-expo` etc.
