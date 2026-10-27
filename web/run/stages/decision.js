/* Decision stage: should the owner pay for a real A/B test, and what to do next.
 * Reads the `decision` from the run snapshot (S.decision is not in the shared state, so this stage keeps its own copy
 * from GET /api/runs/:id/decision, which builds one without an LLM if the run has none).
 * Shape: see src/report/decision.ts (Decision). Approve/Reject: POST /api/runs/:id/decision/actions/:action {choice}.
 * Simulating C reuses POST /api/runs/:id/version-c/run {text}, the same route the Ask why stage uses. */
import { h, s, mount, variantChip, actPill, spin, fmtInt } from '../../core/dom.js';
import { qidChip } from '../../core/ui.js';
import { current } from '../../core/state.js';
import { api, fail } from '../../core/api.js';
import { stagger, reduced } from '../../core/motion.js';

const CALL = {
  cancel_ab: ['bad', 'Do not run the A/B test'],
  run_ab: ['warn', 'A real test is affordable'],
  launch_winner: ['good', 'Launch the winner'],
};
const pctStr = (x, d = 0) => (x == null ? '-' : `${(x * 100).toFixed(d)}%`);
const variantVar = (v) => { const k = String(v || '').toLowerCase(); return k === 'a' || k === 'b' || k === 'c' ? `var(--${k})` : 'var(--accent)'; };
const STATUS = { done: ['good', 'Done'], proposed: ['warn', 'Proposed'], approved: ['good', 'Approved'], rejected: ['bad', 'Rejected'] };

export default {
  id: 'decision',
  mount(el, ctx) {
    const { S, bus, id } = ctx;
    const root = h('div.dc'); el.append(root);
    const cleanups = [];
    let D = null, loading = false, loadErr = null, shown = false;
    const notes = {};   // action id -> { note, launch_plan } returned by the POST route

    async function load() {
      if (loading) return;
      loading = true; loadErr = null; draw();
      try { D = await api(`/api/runs/${encodeURIComponent(id)}/decision`); }
      catch (e) { loadErr = e.message; }
      loading = false; draw();
    }

    /* ---------------------------------------------------------- pieces */
    const sec = (eyebrow, title, sub, ...kids) => h('section.dc-sec',
      h('div.dc-sec-head', h('div.dc-eyebrow', eyebrow), h('h3', title), sub ? h('span.muted', sub) : null), kids);

    // people needed vs local Instagram users, with the budget line
    function sizeChart(d) {
      const need = d.sample_size.total, aud = d.audience.local_instagram_users, cap = d.affordable.max_share;
      if (need == null || !aud) {
        return h('div.dc-size', h('p.muted', need == null ? 'The two versions are tied in the simulation, so no sample size can be worked out.' : 'The local audience size is not available.'));
      }
      const share = need / aud;
      const scale = Math.max(1, share);                  // bar width = audience; overflow shown when need > audience
      const needW = Math.min(100, (share / scale) * 100), lineW = (cap / scale) * 100;
      const over = share > cap;
      return h('div.dc-size',
        h('div.dc-size-nums',
          h('div', h('b.dc-big', fmtInt(need)), h('span', ' people needed'), h('div.expl', `${fmtInt(d.sample_size.per_version)} per version, to detect the simulated gap at ${pctStr(d.sample_size.alpha, 0)} significance and ${pctStr(d.sample_size.power, 0)} power`)),
          h('div', h('b.dc-big', fmtInt(aud)), h('span', ' local Instagram users'), h('div.expl', d.audience.place + ' (estimate)'))),
        h('div.dc-bar', { role: 'img', 'aria-label': `${fmtInt(need)} people needed is ${pctStr(share, 0)} of ${fmtInt(aud)} local Instagram users. The budget line is at ${pctStr(cap, 0)}.` },
          h('div.dc-bar-fill' + (over ? '.over' : ''), { style: { width: `${needW}%` } }),
          h('div.dc-bar-line', { style: { left: `${lineW}%` } }, h('span', `${pctStr(cap, 0)} budget line`))),
        h('div.dc-bar-legend',
          h('span', h('i.dc-sw.need' + (over ? '.over' : '')), `${fmtInt(need)} needed = ${pctStr(share, 0)} of local users`),
          h('span', h('i.dc-sw.line'), `${pctStr(cap, 0)} budget line = ${fmtInt(d.affordable.per_version * 2)} people`)),
        h('p.expl', over ? 'The test needs more people than the budget line allows.' : 'The test fits under the budget line.'),
        h('div.dc-src', d.audience.query_id ? [h('span.muted', 'Audience number comes from query '), qidChip(d.audience.query_id)] : null, h('span.muted', ` ${d.audience.source}.`)));
    }

    // a quote linked to its action: who said it, what they did, what they thought; opens the person
    function quote(aid, reason, variant) {
      const q = S.report?.quotes?.[aid];
      return h('div.dc-q', { style: { '--vc': variantVar(q?.variant || variant) }, 'data-aid': aid },
        q ? h('div.dc-q-src', variantChip(q.variant), h('b', q.agent_id), actPill(q.action)) : null,
        q?.text ? h('div.dc-q-say', `"${q.text}"`) : null,
        h('div.dc-q-why', q?.text ? h('span.muted', 'thought: ') : null, reason ? `"${reason}"` : h('span.muted', 'No private reason was logged.')),
        h('div.dc-q-foot', h('span.chip.qid', `action ${aid}`),
          q ? h('button.btn.sm.ghost', { title: 'Open this person and ask them why', onclick: () => current.openAgent?.(q.agent_id, { world: q.world_id }) }, `Open ${q.agent_id}`) : null));
    }
    function themeCol(title, kind, list) {
      const col = h('div.dc-col.' + kind, h('div.dc-col-head', h('h4', title), h('span.chip', `${list.length}`)));
      if (!list.length) col.append(h('div.empty', 'None reported.'));
      for (const t of list) col.append(h('div.dc-theme', { style: { '--vc': variantVar(t.variant) } },
        h('div.dc-theme-head', variantChip(t.variant), h('b', t.theme)),
        t.quotes?.length ? h('div.dc-qs', t.quotes.map((q) => quote(q.action_id, q.reason, t.variant))) : h('div.muted', 'No quotes attached.')));
      return col;
    }

    function versionC(d) {
      const v = d.variant;
      if (!v) return sec('Version C', 'No draft yet', null, h('p.muted', 'No Version C was drafted for this decision. The Ask why stage can draft one.'));
      const ok = v.honesty?.ok;
      return sec('Version C', 'A bolder version, drafted from the objections', 'a draft, never posted on its own',
        h('div.dc-post', { style: { '--vc': 'var(--c)' } }, h('span.dc-post-tag', 'Version C draft'), h('p', v.text)),
        v.rationale ? h('p.dc-why', h('b', 'Why: '), v.rationale) : null,
        v.targets?.length ? h('div.chips', { style: { marginBottom: '12px' } }, v.targets.map((t) => h('span.chip', t))) : null,
        h('div.dc-honesty.' + (ok ? 'ok' : 'warn'),
          s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, s('path', { d: 'M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z' }), s('path', { d: ok ? 'M8 12.5l3 3 5-6' : 'M12 8v5M12 16v.5' })),
          h('div', h('b', 'Honesty check: '), ok ? 'passed. Price and offer are kept, no invented claims.' : 'issues found.', !ok && v.honesty?.issues?.length ? h('ul', v.honesty.issues.map((i) => h('li', i))) : null)));
    }

    function launchPlan(d) {
      const p = d.plan, t = p.targeting || {};
      const row = (k, v) => h('div.dc-kv', h('dt', k), h('dd', v));
      return sec('Launch plan', 'What a real test would look like', 'nothing here has been posted or paid for',
        h('div.dc-plan',
          h('div.dc-variants', p.variants.map((v) => h('div.dc-post', { style: { '--vc': variantVar(v.label.replace(/^.*?([ABC])\b.*$/i, '$1')) } }, h('span.dc-post-tag', v.label), h('p', v.text)))),
          h('dl.dc-kvs',
            row('Targeting', `${t.platform || 'Instagram'}, ${t.place || ''}${t.zip ? ` (${t.zip})` : ''}${t.age_bands?.length ? `, ages ${t.age_bands.join(', ')}` : ''}`),
            t.note ? row('Targeting note', t.note) : null,
            row('People per version', `${fmtInt(p.per_version)} (${fmtInt(p.total)} in total)`),
            row('Success metric', p.success_metric),
            row('Decision rule', p.decision_rule),
            row('Stop rule', p.stop_rule)),
          h('div.dc-assume', h('h4', h('span.chip.warn', 'Assumptions'), ' these are not measured'),
            h('ul', p.assumptions.map((a) => h('li', a))))));
    }

    /* ---------------------------------------------------------- actions */
    async function decide(a, choice, box) {
      const btns = box.querySelectorAll('button'); btns.forEach((b) => { b.disabled = true; });
      try {
        const r = await api(`/api/runs/${encodeURIComponent(id)}/decision/actions/${encodeURIComponent(a.id)}`, { method: 'POST', body: { choice } });
        Object.assign(a, r.action || { status: choice === 'approve' ? 'approved' : 'rejected' });
        notes[a.id] = { note: r.note, launch_plan: r.launch_plan };
        draw();
      } catch (e) { fail(e); btns.forEach((b) => { b.disabled = false; }); }
    }
    async function simulate(d, btn) {
      const text = d.variant?.text;
      if (!text) return fail(new Error('There is no Version C draft to simulate.'));
      btn.disabled = true; mount(btn, spin(), ' Starting...');
      try { const n = await api(`/api/runs/${encodeURIComponent(id)}/version-c/run`, { method: 'POST', body: { text } }); location.hash = `#/run/${n.run_id}`; }
      catch (e) { fail(e); btn.disabled = false; mount(btn, 'Simulate C on the same crowd'); }
    }
    function actionCard(d, a) {
      const auto = a.policy === 'auto', [stCls, stLabel] = STATUS[a.status] || ['', a.status];
      const box = h('li.dc-act.' + a.status, { 'data-action': a.id },
        h('div.dc-act-top',
          h('span.chip.' + (auto ? 'on' : 'warn'), auto ? 'Runs on its own' : 'Needs your approval'),
          h('span.chip.' + stCls, stLabel)),
        h('b.dc-act-title', a.title),
        h('p.dc-act-detail', a.detail),
        h('p.expl', a.why_policy),
        a.evidence?.length ? h('div.dc-act-ev', h('span.muted', 'Evidence '), a.evidence.slice(0, 6).map((e) => (/^q_/.test(e) ? qidChip(e) : h('span.chip.qid', e)))) : null);
      const n = notes[a.id];
      if (!auto && a.status === 'proposed') {
        box.append(h('div.dc-act-btns',
          h('button.btn.primary', { onclick: () => decide(a, 'approve', box) }, 'Approve'),
          h('button.btn', { onclick: () => decide(a, 'reject', box) }, 'Reject')));
      }
      if (auto && a.kind === 'simulate_variant' && a.status === 'proposed') {
        const b = h('button.btn.primary', { title: 'Runs a new simulation on the local model; it can take a while' }, 'Simulate C on the same crowd');
        b.onclick = () => simulate(d, b);
        box.append(h('div.dc-act-btns', b, h('span.expl', 'Starts a new run: same crowd, graph and schedule.')));
      }
      if (!auto && (a.status === 'approved' || a.status === 'rejected')) {
        box.append(h('div.dc-act-done',
          n?.note ? h('p', n.note) : h('p.muted', a.decided_at ? `Decided ${new Date(a.decided_at).toLocaleString()}.` : null),
          a.status === 'approved' ? h('a.btn.sm', { href: n?.launch_plan || `/api/runs/${encodeURIComponent(id)}/launch-plan.json`, download: '' }, 'Download launch plan') : null));
      }
      return box;
    }

    /* ---------------------------------------------------------- render */
    function draw() {
      if (loading && !D) return mount(root, h('div.dc-wait.muted', spin(), ' Working out the decision...'));
      if (!D) return mount(root, h('div.banner.bad', loadErr ? `Could not load the decision: ${loadErr}` : 'No decision yet.'),
        h('p'), h('button.btn', { onclick: load }, 'Try again'));
      const d = D, [cls, label] = CALL[d.call] || ['', d.call];
      mount(root,
        h('header.dc-head',
          h('div.dc-eyebrow', 'Decision', h('span.chip.' + cls, label), h('span.muted', 'no model call, computed from the finished run')),
          h('h2.dc-headline', d.headline)),
        sec('The numbers', 'People a real test needs vs people you can reach', null, sizeChart(d)),
        sec('Why', 'Reasons', null, h('ul.dc-reasons', d.reasons.map((r) => h('li', r)))),
        sec('In their words', 'Why people hesitated, and what drew them', 'each quote links to the action it came from',
          h('div.dc-cols', themeCol('Why people hesitated', 'objections', d.brief?.objections || []), themeCol('What drew them', 'likes', d.brief?.likes || []))),
        versionC(d), launchPlan(d),
        sec('Next steps', 'Actions', 'what runs on its own, and what waits for you', h('ul.dc-acts', d.actions.map((a) => actionCard(d, a)))));
      if (!reduced() && !shown) { shown = true; stagger(root, { y: 14, gap: 50, ms: 520 }); }
    }

    // the decision can arrive after the report; pick it up on done/snapshot only if we have none yet
    cleanups.push(bus.on('done', () => { if (!D && shown) load(); }));
    draw();
    return {
      show() { if (!D && !loading) load(); },
      destroy() { cleanups.forEach((f) => f()); },
    };
  },
};
