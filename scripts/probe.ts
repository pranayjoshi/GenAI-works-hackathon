/** Probe every integration: model providers (one tiny call per role), data sources, federation engine. */
import { providerStatus, chat } from '../src/llm.js';
import { registerSources, ensureCensus, sourceSummary } from '../src/data/sources.js';
import { config, type Role } from '../src/config.js';

const st = await providerStatus();
console.log(`Provider order: ${st.order.join(' -> ')}   sample mode: ${st.sampleMode}`);
for (const p of st.providers) console.log(`  ${p.provider.padEnd(10)} ${p.online ? 'ONLINE ' : p.configured ? 'offline' : 'not set'}  ${p.detail}`);
if (!config.sampleMode) {
  for (const role of ['crowd', 'reason', 'review'] as Role[]) {
    const t0 = Date.now();
    try {
      const r = await chat({ role, system: 'Reply with one word.', user: 'Say ok.', maxTokens: 20, tag: 'probe', thinking: false });
      console.log(`  ${role.padEnd(8)} ${String(Date.now() - t0).padStart(6)} ms  served_by=${r.served_by}  reply=${JSON.stringify(r.text.slice(0, 30))}`);
    } catch (e) { console.log(`  ${role.padEnd(8)} FAILED ${(e as Error).message.slice(0, 160)}`); }
  }
}
await registerSources();
await ensureCensus(['86000US78704', '01000US']);
const s = await sourceSummary();
console.log(`\nFederated SQL engine: ${s.engine}`);
for (const t of s.tables) console.log(`  ${t.table.padEnd(18)} ${String(t.rows).padStart(8)} rows  ${t.kind} (${t.label})`);
process.exit(0);
