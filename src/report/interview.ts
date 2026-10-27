/**
 * Interviews, ask-a-segment and focus groups (BUILD_PLAN §6.3).
 * Grounding rule: an agent may cite only its own H-MEM lines (what it saw, did and felt) and its persona.
 * Citations are validated against the memory; anything uncited is flagged in the UI.
 */
import { z } from 'zod';
import { chat } from '../llm.js';
import { agentLog } from '../util/agentlog.js';
import type { Persona } from '../schemas/persona.js';
import type { MemoryLine } from '../memory/hmem.js';
import { allRecords, memoryFor, type RunState } from '../sim/run.js';
import { Rng } from '../util/core.js';

const Answer = z.object({
  answer: z.string().describe('first person, in this person\'s own voice, 1-4 sentences'),
  cited: z.array(z.string()).describe('memory ids (like m3) that the answer relies on'),
  saw_it: z.boolean().describe('false if the question is about something not in memory'),
});

export interface InterviewResult {
  agent_id: string; world_id: string; persona: Persona; answer: string; saw_it: boolean;
  citations: { id: string; hour: number; text: string; action_id?: string }[];
  invalid_citations: string[]; served_by: string;
}

function personaBrief(p: Persona) {
  return `Age ${p.age}, ${p.education}, household income ${p.income_band}, ${p.daily_minutes} min/day on Instagram, price sensitivity ${p.price_sensitivity}, ad skepticism ${p.skepticism}${p.customer ? `, already a customer (${p.customer.visits_per_month} visits/month)` : ''}. ${p.voice}`;
}

export async function interview(st: RunState, worldId: string, agentId: string, question: string, history: { q: string; a: string }[] = []): Promise<InterviewResult> {
  const persona = st.personas.find((p) => p.id === agentId);
  if (!persona) throw new Error(`No agent ${agentId}`);
  const mem = memoryFor(st, worldId, agentId);
  const all = mem.all();
  const relevant = mem.recall(question, 6);
  const lines: MemoryLine[] = [...new Map([...relevant, ...all.slice(-6)].map((l) => [l.id, l])).values()].sort((a, b) => a.hour - b.hour);
  const alias = new Map(lines.map((l, i) => [`m${i + 1}`, l]));
  const memText = lines.length ? [...alias.entries()].map(([k, l]) => `[${k}] ${l.text}`).join('\n') : '(nothing: this person never saw the post)';
  const post = st.spec.posts.find((p) => worldId.endsWith(`:${p.variant}`));
  const system = `You are a simulated person being interviewed after a week of normal Instagram use. Stay in character.
Who you are: ${personaBrief(persona)}
Grounding rule: you can only talk about what is in YOUR MEMORY below, plus who you are. Cite the memory ids you rely on.
If asked about something that is not in your memory (another ad, another version, something you never saw), say plainly that you didn't see it, and set saw_it to false.
Never invent conversations, visits or purchases that are not in memory. Talk like a normal person, not a marketer. Do not mention numbers like "price sensitivity".`;
  const user = `YOUR MEMORY (things you saw and did):\n${memText}\n\n${history.length ? `Earlier in this interview:\n${history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join('\n')}\n\n` : ''}Interviewer: ${question}`;
  const r = await chat({ role: 'interview', system, user, schema: Answer, schemaName: 'InterviewAnswer', tag: `${st.spec.run_id}:interview`, maxTokens: 350, temperature: 0.6 });
  // an unvalidated reply is never shown in the agent's voice
  const data = r.data ?? { answer: '(No grounded answer: the reply could not be validated against this person\'s memory. Try asking again.)', cited: [], saw_it: false };
  const valid = data.cited.filter((c) => alias.has(c));
  const invalid = data.cited.filter((c) => !alias.has(c));
  // H-MEM feedback: cited memories were helpful for answering
  for (const c of valid) {
    const id = alias.get(c)!.id;
    try { mem.hmem.feedback(id, 'helpful'); } catch { /* id belongs to restored line */ }
  }
  const recs = allRecords(st).filter((x) => x.world_id === worldId && x.agent_id === agentId);
  agentLog({ run_id: st.spec.run_id, agent_name: 'Interviewer', action: 'interview', target_agent: 'MemoryAgent', status: r.data ? (invalid.length ? 'needs_revision' : 'success') : 'fallback', served_by: r.served_by, model: r.model, retry_count: r.repaired ? 1 : 0, input_summary: `${agentId} in ${worldId}: ${question.slice(0, 80)}`, output_summary: `${valid.length} valid memory citations, ${invalid.length} invalid; saw_it ${data.saw_it}`, refs: { memory_ids: valid.map((c) => alias.get(c)!.id) } });
  return {
    agent_id: agentId, world_id: worldId, persona, answer: data.answer.replace(/\[m\d+\]/g, '').trim(), saw_it: data.saw_it,
    citations: valid.map((c) => {
      const l = alias.get(c)!;
      const rec = recs.find((x) => x.memory_ids.includes(l.id));
      return { id: l.id, hour: l.hour, text: l.text, action_id: rec?.id };
    }),
    invalid_citations: invalid, served_by: r.served_by + (post ? '' : ''),
  };
}

/** Ask a segment: sample up to 6 deciders from the segment, interview each, summarize the pattern. */
export async function askSegment(st: RunState, segment: string, question: string, variant?: string) {
  const [dim, val] = segment.split(':');
  const match = (p: Persona) => (dim === 'role' ? p.role === val : dim === 'age' ? p.age_band === val : dim === 'income' ? p.income_band === val : dim === 'customer' ? Boolean(p.customer) === (val === 'yes') : true);
  const recs = allRecords(st).filter((r) => r.item_kind !== 'event' && (!variant || r.variant === variant) && r.seed === st.spec.seeds[0]);
  const rng = new Rng(`${st.spec.crowd_seed ?? st.spec.run_id}:${segment}:${question}`);
  const byAgent = new Map<string, { worlds: Set<string>; vocal: boolean; world: string }>();
  for (const r of recs) {
    const p = st.personas.find((x) => x.id === r.agent_id);
    if (!p || !match(p)) continue;
    const cur = byAgent.get(r.agent_id) ?? { worlds: new Set<string>(), vocal: false, world: '' };
    cur.worlds.add(r.world_id);
    cur.vocal = cur.vocal || r.action === 'comment' || r.action === 'share' || Boolean(r.unsaid);
    byAgent.set(r.agent_id, cur);
  }
  // each person is interviewed in one of the worlds they acted in, chosen by the seeded rng (balanced A/B, replay-stable)
  for (const [, v] of [...byAgent.entries()].sort(([a], [b]) => a.localeCompare(b))) v.world = rng.pick([...v.worlds].sort());
  const entries = rng.shuffle([...byAgent.entries()]);
  const chosen = [...entries.filter(([, v]) => v.vocal).slice(0, 3), ...entries.filter(([, v]) => !v.vocal)].slice(0, 6);
  const answers = await Promise.all(chosen.map(([id, v]) => interview(st, v.world, id, question).catch(() => null)));
  const ok = answers.filter(Boolean) as InterviewResult[];
  let summary = '';
  try {
    const s = await chat({
      role: 'reason',
      system: 'Summarize what a group of simulated people said, in 2-3 plain sentences. Name the common pattern and any disagreement. Do not add facts they did not say.',
      user: `Question: ${question}\nSegment: ${segment}\n${ok.map((a) => `${a.agent_id} (${a.world_id}): ${a.answer}`).join('\n')}`,
      tag: `${st.spec.run_id}:segment`, maxTokens: 300,
    });
    summary = s.text.trim();
  } catch { summary = ''; }
  return { segment, question, answers: ok, summary };
}

/** Focus group: a moderator seats agents from different segments, shows both posts, runs a short discussion. */
export async function focusGroup(st: RunState, opts: { size?: number; turns?: number; topic?: string }, onTurn?: (t: { speaker: string; text: string; agent_id?: string }) => void) {
  const size = Math.min(8, Math.max(3, opts.size ?? 6));
  const turns = Math.min(3, Math.max(1, opts.turns ?? 2));
  const seed = st.spec.seeds[0];
  const rng = new Rng(`${st.spec.crowd_seed ?? st.spec.run_id}:focus:${opts.topic ?? ''}`);
  const worldsOf = new Map<string, Set<string>>();
  for (const r of allRecords(st)) if (r.seed === seed && r.item_kind !== 'event') { if (!worldsOf.has(r.agent_id)) worldsOf.set(r.agent_id, new Set()); worldsOf.get(r.agent_id)!.add(r.world_id); }
  const decided = new Map<string, string>();
  for (const [id, ws] of [...worldsOf.entries()].sort(([a], [b]) => a.localeCompare(b))) decided.set(id, rng.pick([...ws].sort()));
  const pool = rng.shuffle([...decided.keys()].sort().map((id) => st.personas.find((p) => p.id === id)!).filter(Boolean));
  const seats: Persona[] = [];
  const seen = new Set<string>();
  for (const p of pool) { const k = `${p.role}:${p.age_band}`; if (!seen.has(k)) { seats.push(p); seen.add(k); } if (seats.length >= size) break; }
  for (const p of pool) { if (seats.length >= size) break; if (!seats.includes(p)) seats.push(p); }
  const [A, B] = st.spec.posts;
  const transcript: { speaker: string; text: string; agent_id?: string }[] = [];
  const say = (t: { speaker: string; text: string; agent_id?: string }) => { transcript.push(t); onTurn?.(t); };
  const topic = opts.topic || `Which of these two posts from ${st.spec.business} would actually get you in the door, and why?`;
  say({ speaker: 'Moderator', text: `Thanks for coming. Here are two posts. A: "${A.text}" B: "${B.text}". ${topic}` });
  for (let t = 0; t < turns; t++) {
    for (const p of seats) {
      const world = decided.get(p.id)!;
      const mem = memoryFor(st, world, p.id).all().slice(-4).map((l) => l.text).join(' | ');
      const r = await chat({
        role: 'crowd',
        system: `You are a simulated person in a small focus group. Who you are: ${personaBrief(p)}. Your memory of the week: ${mem || 'you never saw either post'}.
You saw one version during the week (the one in your memory); the moderator is now showing you both. Speak in 1-2 short sentences in your own voice. React to what others said when it's relevant. Never invent visits or purchases.`,
        user: `Transcript so far:\n${transcript.slice(-8).map((x) => `${x.speaker}: ${x.text}`).join('\n')}\n\nYour turn (${p.id}):`,
        tag: `${st.spec.run_id}:focus`, maxTokens: 120, temperature: 0.8,
      });
      say({ speaker: `${p.id} (${p.age}, ${p.role})`, text: r.text.replace(/^["\s]+|["\s]+$/g, '').slice(0, 400), agent_id: p.id });
    }
    if (t < turns - 1) {
      const m = await chat({ role: 'reason', system: 'You are a focus-group moderator. Ask one short follow-up question that probes the main disagreement. One sentence.', user: transcript.slice(-seats.length).map((x) => `${x.speaker}: ${x.text}`).join('\n'), tag: `${st.spec.run_id}:focus`, maxTokens: 80 });
      say({ speaker: 'Moderator', text: m.text.trim() });
    }
  }
  const wrap = await chat({ role: 'reason', system: 'Summarize this focus group in 2 sentences: where people agreed, where they split, and what would change minds. No new facts.', user: transcript.map((x) => `${x.speaker}: ${x.text}`).join('\n'), tag: `${st.spec.run_id}:focus`, maxTokens: 200 });
  say({ speaker: 'Moderator summary', text: wrap.text.trim() });
  return { seats: seats.map((p) => p.id), transcript };
}
