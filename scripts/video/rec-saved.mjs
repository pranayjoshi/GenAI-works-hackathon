// Saved-run beats, filmed in the real UI on the recording server (:8790).
// Usage: node scripts/video/rec-saved.mjs crowd worlds signals verdict report   (any subset)
import { startRecorder } from './lib/recorder.mjs';
import { sleep } from './lib/util.mjs';

export const RUN = process.env.RUN || '20261027-south-congress-coffe-e52a';   // the saved demo run (set RUN=<id>)
export const LIVE_RUN = process.env.LIVE_RUN || '20261027-south-congress-coffe-bc40'; // the run created live on camera
export const RUN_C = process.env.RUN_C || '20261027-south-congress-coffe-344c';
const stage = (s, id = RUN) => `/#/run/${id}/${s}`;

async function settle(p) { await p.waitForLoadState('networkidle').catch(() => {}); await sleep(1800); }

const CLIPS = {
  /** Agents stage: the loop line and the three agent traits, then the flow replay */
  async agents(r, p) {
    await r.start(stage('pipeline')); await settle(p);
    r.mark('start');
    await sleep(1000);
    await r.moveTo(p.getByText(/Build the audience/).first(), { ms: 900 }).catch(() => {});
    await sleep(1800);
    for (const t of ['Uses tools', 'Critiques itself', 'Asks permission']) {
      await r.moveTo(p.locator('.pl-traits .chip', { hasText: t }).first(), { ms: 700 }).catch(() => {});
      await sleep(1500);
    }
    await r.click(p.getByRole('button', { name: 'Replay flow' }), { after: 500 }).catch(() => {});
    r.mark('replay');
    await sleep(6000);
    r.mark('end');
  },
  /** the Data sources card of the run created live on camera (all five sources served by Zetaris) */
  async sources(r, p) {
    await r.start(stage('crowd', LIVE_RUN)); await settle(p);
    const card = p.locator('text=Data sources').last();
    await r.scrollToEl(card, { offset: 90, ms: 10 });
    await sleep(1500);
    r.mark('start');
    await sleep(800);
    const cards = p.locator('text=US Census Bureau ACS 5-year, text=Pew Research Center, text=Behaviour priors, text=Business customer list, text=Upworthy Research Archive');
    for (const name of ['US Census', 'Pew Research', 'Behaviour priors', 'Business customer', 'Upworthy']) {
      await r.moveTo(p.getByText(name, { exact: false }).last(), { ms: 750, dy: 40 }).catch(() => {});
      await sleep(900);
    }
    await r.moveTo(p.getByText('local Instagram users').last(), { ms: 900 }).catch(() => {});
    await sleep(1200);
    await r.moveTo(p.getByText('ran on Zetaris').last(), { ms: 900 }).catch(() => {});
    await sleep(3000);
    r.mark('end');
  },
  async crowd(r, p) {
    await r.start(stage('crowd')); await settle(p);
    r.mark('start');
    await sleep(1500);
    await r.moveTo(p.locator('text=AUDIENCE ESTIMATE').first(), { ms: 900 }).catch(() => {});
    await sleep(1600);
    await r.moveTo(p.locator('.cw-q').first(), { ms: 900 }).catch(() => {});
    await sleep(800);
    // pick one person on the sphere (nearest point to the click)
    const sphere = p.locator('#view canvas').first();
    const b = await sphere.boundingBox();
    await r.click({ x: b.x + b.width * 0.52, y: b.y + b.height * 0.46 }, { after: 2000 });
    r.mark('persona');
    await sleep(2500);
    await sleep(500);
    await r.click(p.locator('.dz-tab:visible', { hasText: 'Receipts' }), { after: 1200 });
    r.mark('receipts');
    await sleep(3500);
    r.mark('end');
  },
  async worlds(r, p) {
    await r.start(stage('worlds')); await settle(p);
    await p.getByRole('button', { name: 'Seed 2', exact: true }).click().catch(() => {}); await sleep(1500);
    r.mark('start');
    await sleep(800);
    await r.moveTo(p.locator('span.chip.good').filter({ hasText: 'twins identical' }).first(), { ms: 900 }).catch(() => {});
    await sleep(2200);
    await r.moveTo(p.locator('span.chip.good').filter({ hasText: 'twins identical' }).nth(1), { ms: 700 }).catch(() => {});
    await sleep(1600);
    await r.scrollToEl(p.locator('.wx-card').first(), { offset: 330, ms: 1400 });
    await sleep(1800);
    await r.click(p.locator('.wx-card:not(.scroll) .who').first(), { after: 1500 });
    r.mark('drawer');
    await r.click(p.locator('.dz-tab:visible', { hasText: 'Timeline' }), { after: 1200 });
    r.mark('timeline');
    await r.moveTo(p.locator('.dz-mem:visible').first(), { ms: 800 }).catch(() => {});
    await sleep(4500);
    r.mark('end');
  },
  async signals(r, p) {
    await r.start(stage('signals')); await settle(p);
    r.mark('start');
    await sleep(1200);
    // walk the cursor along the chart to the round-8 flag
    const chart = p.locator('.sg-main svg, svg').filter({ has: p.locator('path') }).first();
    const b = await chart.boundingBox();
    await r.moveTo({ x: b.x + b.width * 0.25, y: b.y + b.height * 0.55 }, { ms: 900 });
    await sleep(1200);
    await r.moveTo({ x: b.x + b.width * 0.45, y: b.y + b.height * 0.55 }, { ms: 1500 });
    await sleep(1000);
    await r.moveTo(p.locator('text=1 injected event').first(), { ms: 900 }).catch(() => {});
    await sleep(1500);
    await r.moveTo({ x: b.x + b.width * 0.61, y: b.y + b.height * 0.06 }, { ms: 1000 });
    await sleep(2500);
    await r.moveTo({ x: b.x + b.width * 0.8, y: b.y + b.height * 0.6 }, { ms: 1400 });
    await sleep(3000);
    r.mark('end');
  },
  async verdict(r, p) {
    await r.start(stage('verdict')); await settle(p);
    r.mark('start');
    await sleep(2500);
    await r.moveTo(p.getByText(/leads on intent/).first(), { ms: 900 }).catch(() => {});
    await sleep(2000);
    await r.scroll(380, { ms: 1400 });
    await sleep(1000);
    await r.moveTo(p.getByText(/likely to be the better/).last(), { ms: 900 }).catch(() => {});
    await sleep(4000);
    r.mark('end');
  },
  async report(r, p) {
    await r.start(stage('report')); await settle(p);
    r.mark('start');
    await sleep(1500);
    await r.moveTo(p.locator('.rp-receipts .chip').first(), { ms: 900 }).catch(() => {});
    await sleep(1500);
    await r.scrollToEl(p.locator('.rp-critic').first(), { offset: 200, ms: 1500 }).catch(() => {});
    r.mark('critic');
    await sleep(3200);
    await r.scrollToEl(p.locator('.rp-qc').first(), { offset: 300, ms: 1500 });
    await sleep(1000);
    const q = p.locator('.rp-qc').first();
    await r.click(q.locator('.rp-flip').first(), { after: 1500 });
    r.mark('flip');
    await sleep(3500);
    r.mark('end');
  },
  /** Ask why: interview one person live (Super), then the focus group (sped up in the edit) */
  async ask(r, p) {
    const who = process.env.ASK_PERSON || 'p0176', world = process.env.ASK_WORLD || 's1:A';
    const q = process.env.ASK_Q || 'Why did you scroll past the oat milk honey latte post?';
    await r.start(stage('ask')); await settle(p);
    r.mark('start');
    await r.click(p.locator('.ak-card[data-tool="agent"]'), { after: 900 });
    await r.type(p.getByLabel('Search people'), who, { delay: 70 });
    await sleep(700);
    await r.click(p.locator(`.ak-tile[data-id="${who}"]`), { after: 1500 });
    if (process.env.ASK_TWIN) {   // same person, both worlds: what they thought of A, then of B
      await r.click(p.locator('.dz-tab:visible', { hasText: 'Timeline' }), { after: 900 });
      await r.click(p.locator('.dz-world:visible').filter({ hasText: 's1:A' }).first(), { after: 600 });
      r.mark('twin_a');
      await r.moveTo(p.locator('.dz-tl-item:visible').last(), { ms: 700 }).catch(() => {});
      await sleep(3200);
      await r.click(p.locator('.dz-world:visible').filter({ hasText: 's1:B' }).first(), { after: 600 });
      r.mark('twin_b');
      await r.moveTo(p.locator('.dz-tl-item:visible').last(), { ms: 700 }).catch(() => {});
      await sleep(3200);
    }
    await r.click(p.locator('.dz-tab:visible', { hasText: 'Interview' }), { after: 700 });
    const wbtn = p.locator('.dz-world:visible').filter({ hasText: world });
    if (await wbtn.count() && !(await wbtn.first().evaluate((e) => e.classList.contains('on')))) await r.click(wbtn.first(), { after: 700 });
    await r.type(p.getByLabel('Question for ' + who), q, { delay: 22 });
    await sleep(300);
    r.mark('asked');
    await p.keyboard.press('Enter');
    await p.locator('.dz-msg.them .dz-say').last().waitFor({ timeout: 90000 });
    await p.waitForFunction(() => !document.querySelector('.dz-typing'), null, { timeout: 90000 });
    r.mark('answered');
    await sleep(6500);
    r.mark('interview_end');
    await p.keyboard.press('Escape'); await sleep(600);
    await r.click(p.locator('.ak-back'), { after: 700 });
    await r.click(p.locator('.ak-card[data-tool="focus"]'), { after: 900 });
    r.mark('focus');
    await r.click(p.getByRole('button', { name: /Start focus group/ }), { after: 500 });
    r.mark('focus_run');
    await p.waitForFunction(() => /Click a seat/.test(document.querySelector('.ak-fg-status')?.textContent || ''), null, { timeout: 300000 });
    r.mark('focus_done');
    await r.scrollToEl(p.locator('.ak-transcript'), { offset: 200, ms: 1400 });
    await sleep(5000);
    r.mark('end');
  },
  /** Decision: needed vs reachable, reasons, Version C card, then the C run's verdict */
  async decide(r, p) {
    await r.start(stage('decision')); await settle(p);
    r.mark('start');
    await sleep(2500);
    await r.scrollToEl(p.getByText('What a live split test would have needed').first(), { offset: 200, ms: 1400 }).catch(() => {});
    await sleep(1500);
    await r.moveTo(p.getByText('people a live test needs').first(), { ms: 900 }).catch(() => {});
    await sleep(1800);
    await r.moveTo(p.getByText('local Instagram users').first(), { ms: 900 }).catch(() => {});
    await sleep(1800);
    await r.scrollToEl(p.getByText('Reasons', { exact: true }).first(), { offset: 160, ms: 1400 }).catch(() => {});
    await sleep(3500);
    r.mark('versionc');
    const c = p.getByText('A bolder version, drafted from the objections').first();
    await r.scrollToEl(c, { offset: 140, ms: 1400 }).catch(() => {});
    await sleep(1200);
    await r.moveTo(p.getByText(/Honesty check/).first(), { ms: 900 }).catch(() => {});
    await sleep(2500);
    const sim = p.getByText(/Simulate version C against A/).first();
    await r.scrollToEl(sim, { offset: 300, ms: 1400 }).catch(() => {});
    r.mark('c_result');
    await sleep(3500);
    r.mark('to_c');
    await p.goto(new URL(stage('verdict', RUN_C), p.url()).href); await settle(p);
    r.mark('c_verdict');
    await sleep(1500);
    await r.moveTo(p.getByText(/Version C/).first(), { ms: 900 }).catch(() => {});
    await sleep(5000);
    r.mark('end');
  },
  /** Act: the ad previews (feed/story, enlarge), then Approve on the paused A vs C launch -> preview, nothing sent */
  async act(r, p) {
    await r.start(stage('decision')); await settle(p);
    const sec = p.getByText(/would look in people.s feeds/).first();
    await r.scrollToEl(sec, { offset: 120, ms: 10 }); await sleep(1500);
    r.mark('start');
    await sleep(1200);
    await r.click(p.locator('.ad-toggle button', { hasText: /story/i }), { after: 2200 });
    await r.click(p.locator('.ad-toggle button', { hasText: /feed/i }), { after: 1500 });
    const ad = p.locator('.ad-card, .ad-phone, .ad-grid img').first();
    await r.moveTo(ad, { ms: 900 }).catch(() => {});
    await sleep(1200);
    await r.click(ad, { after: 2500 }).catch(() => {});
    await p.keyboard.press('Escape'); await sleep(900);
    r.mark('launch');
    const act = p.getByText(/Launch Version A in Meta Ads/).first();
    await r.scrollToEl(act, { offset: 260, ms: 1400 }).catch(() => {});
    await sleep(2500);
    const box = p.locator('*', { has: act }).filter({ has: p.getByRole('button', { name: 'Approve' }) }).last();
    await r.click(box.getByRole('button', { name: 'Approve' }).first(), { after: 300 });
    r.mark('approved');
    await p.getByText(/nothing was sent|not sent to Meta/i).first().waitFor({ timeout: 60000 }).catch(() => {});
    await sleep(900);
    await r.scrollToEl(p.getByText(/nothing was sent/i).first(), { offset: 520, ms: 1200 }).catch(() => {});
    r.mark('result');
    await sleep(3500);
    await r.scrollToEl(p.getByText(/would look in people.s feeds/).first(), { offset: 120, ms: 1500 }).catch(() => {});
    r.mark('cards');
    await r.moveTo(p.getByText(/nothing sent/i).first(), { ms: 900 }).catch(() => {});
    await sleep(3500);
    r.mark('end');
  },
};

const want = process.argv.slice(2);
for (const name of want.length ? want : Object.keys(CLIPS)) {
  const r = await startRecorder(name);
  try { await CLIPS[name](r, r.page); } catch (e) { console.error(`  [${name}]`, e.message); r.mark('end'); }
  await r.finish();
}
