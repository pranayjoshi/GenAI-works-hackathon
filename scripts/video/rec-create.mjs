// Live beat: create a test in the real UI (Nightshift + Zetaris on), run it, and film the crowd building.
// Usage: node scripts/video/rec-create.mjs   (needs the recording server on :8790, see scripts/video/README.md)
import fs from 'node:fs';
import path from 'node:path';
import { startRecorder } from './lib/recorder.mjs';
import { ROOT, sleep } from './lib/util.mjs';

const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'input_examples/demo_copy_only.json'), 'utf8'));
const r = await startRecorder('create');
const p = r.page;
await r.start('/#/');
await sleep(1200);
r.mark('form');
const field = (label) => p.locator('.su-field').filter({ has: p.locator(`label:text-is("${label}")`) }).locator('input');
await r.type(field('Business'), ex.business.name);
await r.type(field('Instagram handle'), ex.business.handle);
await r.type(field('Place'), ex.business.address);
await r.type(field('ZIP'), ex.business.zip, { delay: 60 });
await r.type(field('Goal'), ex.business.goal, { delay: 18 });
await sleep(400);
await r.click(p.locator('.su-nav .btn.primary'), { after: 900 });
await r.type(p.getByLabel('Version A caption'), ex.version_a.text, { delay: 14 });
await r.type(p.getByLabel('Version B caption'), ex.version_b.text, { delay: 14 });
await sleep(700);
await r.click(p.locator('.su-nav .btn.primary'), { after: 700 });
await r.click(p.getByRole('button', { name: 'Propose audience' }), { after: 200 });
r.mark('audience');
// wait for the Super-proposed segments and the Census x Pew join (engine chip)
await p.locator('.su-seg.core h3').waitFor({ timeout: 120000 });
r.mark('audience_ready');
await sleep(1500);
await r.moveTo(p.locator('.su-join-head .chip').first(), { ms: 800 });
await sleep(2200);
await r.scrollToEl(p.locator('.su-chart'), { offset: 420, ms: 1000 });
await sleep(1800);
await r.click(p.locator('.su-nav .btn.primary'), { after: 700 });
await r.click(p.getByRole('button', { name: '24 smoke test', exact: true }), { after: 400 });
await r.click(p.getByRole('button', { name: '6 rounds smoke test', exact: true }), { after: 400 });
await r.click(p.getByRole('button', { name: '1 seed one pass', exact: true }), { after: 700 });
await r.click(p.locator('.su-nav .btn.primary'), { after: 1200 });
r.mark('launch');
await r.click(p.getByRole('button', { name: 'Run Ripple' }), { after: 300 });
await p.waitForURL(/#\/run\//, { timeout: 60000 });
const runId = decodeURIComponent(p.url().match(/#\/run\/([^/]+)/)[1]);
console.log('  run id', runId);
r.mark('run');
await sleep(9000);
// query receipts on the Crowd stage, once the crowd is sampled
await r.click(p.locator('.ws-dock-item[data-stage="crowd"]'), { after: 600 });
await p.locator('.cw-q').first().waitFor({ timeout: 180000 });
r.mark('receipts');
await sleep(800);
await r.scrollToEl(p.locator('.cw-q').first(), { offset: 520, ms: 1000 });
await sleep(1200);
await r.click(p.locator('.cw-q').nth(3), { after: 3500 });
r.mark('receipt_open');
await sleep(2500);
await p.keyboard.press('Escape'); await sleep(600);
// Nemotron panel on the Agents stage while the crowd decides
await r.click(p.locator('.ws-dock-item[data-stage="pipeline"]'), { after: 800 });
r.mark('agents');
await sleep(5000);
await r.scrollToEl(p.locator('.pl-nemo, .pl-gauges').first(), { offset: 160, ms: 1200 });
r.mark('nemotron');
await p.locator('.pl-tick').first().waitFor({ timeout: 120000 }).catch(() => {});
await sleep(14000);
r.mark('end');
fs.writeFileSync(path.join(r.dir, 'run-id.txt'), runId);
await r.finish();
