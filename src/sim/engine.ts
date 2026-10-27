/**
 * Runs one world, one round per Markovian step (BUILD_PLAN §4.2, §4.4).
 * Each step: deliver (ad serving, shares, injected events) -> wake -> only agents whose feed changed call the
 * model -> stance transition + speak gate -> spread -> H-MEM write. The step's [STATE_CHECKPOINT] carries
 * the world summary into the next round's prompts.
 */
import { Markovian } from '../../engines/markovian/reference/src/index.ts';
import type { Persona } from '../schemas/persona.js';
import { ENGAGED, VOCAL, type ActionRecord, type ActionType } from '../schemas/action.js';
import { AgentMemory } from '../memory/hmem.js';
import { clamp, round as rnd, sha } from '../util/core.js';
import { agentLog } from '../util/agentlog.js';
import { decideBatch, type AgentTurn } from './crowd.js';
import { guardDecision } from './guard.js';
import { hourLabel } from './schedule.js';
import type { BaseWorld, SimWorld } from './world.js';
import type { FeedItem, InjectedEvent, Post, RunSpec, SimEvent, WorldCounters } from './types.js';

/** Uniform in [0,1) from a hash: identical in twin worlds for the same agent, item and round. */
const hashU = (...parts: (string | number)[]) => parseInt(sha(parts.join('|'), 8), 16) / 0x100000000;

export interface WorldResult {
  world_id: string;
  variant: string;
  seed: number;
  records: ActionRecord[];
  counters: WorldCounters;
  timeline: WorldCounters[];
  memories: Map<string, AgentMemory>;
  stance: Map<string, number>;
  intent: Map<string, boolean>;
  carryovers: string[];
  markovian: { status: string; chunks: number; tokensSaved: number; efficiencyPercent: number };
  world_events: number;
  base_shape: string;
}

export class WorldRunner {
  readonly worldId: string;
  private personas: Map<string, Persona>;
  private feeds = new Map<string, FeedItem[]>();
  readonly memories = new Map<string, AgentMemory>();
  private stance = new Map<string, number>();
  private intent = new Map<string, boolean>();
  private deciders = new Set<string>();
  private exposures = 0;
  readonly records: ActionRecord[] = [];
  currentRound = -1;
  private seen = new Map<string, number>(); // ad-related exposures per agent (first time vs repeat)
  private comments: { agent: string; text: string; round: number }[] = [];
  private timeline: WorldCounters[] = [];
  private carryovers: string[] = [];
  private calls = 0;
  private events: InjectedEvent[];
  private seq = 0;

  constructor(
    private spec: RunSpec,
    private base: BaseWorld,
    private world: SimWorld,
    private post: Post,
    private emit: (e: SimEvent) => void,
    private liveEvents: () => InjectedEvent[],
    private abort?: AbortSignal,
  ) {
    this.worldId = world.worldId;
    this.personas = new Map(base.personas.map((p) => [p.id, p]));
    for (const p of base.personas) {
      this.feeds.set(p.id, []);
      this.memories.set(p.id, new AgentMemory(p.id, this.worldId, base.startMs, spec.hourStep));
      this.stance.set(p.id, 0);
    }
    this.events = [];
  }

  private roundMs(r: number) { return this.base.startMs + r * this.spec.hourStep * 3_600_000; }
  private label(r: number) { return hourLabel(this.base.schedule.hours[r], r, this.spec.hourStep, this.spec.startHour); }

  private counters(r: number): WorldCounters {
    let intent = 0, stanceSum = 0;
    for (const id of this.deciders) { if (this.intent.get(id)) intent++; stanceSum += this.stance.get(id) ?? 0; }
    const adRecs = this.records.filter((x) => x.item_kind !== 'event');
    return {
      round: r, hour_label: this.label(r), exposures: this.exposures, deciders: this.deciders.size, intent,
      engaged: adRecs.filter((x) => ENGAGED.has(x.action)).length,
      vocal: new Set(adRecs.filter((x) => VOCAL.has(x.action)).map((x) => x.agent_id)).size,
      hides: adRecs.filter((x) => x.action === 'hide').length,
      stance_sum: rnd(stanceSum, 3), calls: this.calls,
    };
  }

  private topComments(forAgent: string): string[] {
    if (!this.comments.length) return [];
    const follows = new Set(this.base.graph.follows.get(forAgent) ?? []);
    const friends = this.comments.filter((c) => follows.has(c.agent) && c.agent !== forAgent);
    const recent = this.comments.filter((c) => c.agent !== forAgent).slice(-3);
    const out: string[] = [];
    for (const c of [...friends.slice(-1), ...recent.reverse()]) {
      const t = c.text.slice(0, 120);
      if (!out.includes(t)) out.push(t);
      if (out.length >= 2) break;
    }
    return out;
  }

  private carryover(r: number): string {
    const c = this.counters(r);
    const shares = this.records.filter((x) => x.action === 'share').length;
    const mood = c.deciders ? c.stance_sum / c.deciders : 0;
    const moodWord = mood > 0.25 ? 'warm' : mood > 0.05 ? 'mildly positive' : mood < -0.25 ? 'cold' : mood < -0.05 ? 'mildly negative' : 'mixed';
    const ev = this.events.filter((e) => e.round <= r).slice(-1)[0];
    return `Around the neighborhood: ${c.deciders} people have seen ${this.post.business}'s post, ${this.comments.length} comments and ${shares} shares so far; overall mood ${moodWord}.${ev ? ` News going around: ${ev.text}.` : ''}`;
  }

  private async round(r: number, carry: string): Promise<string> {
    const sched = this.base.schedule;
    this.currentRound = r;
    // 1. deliver
    for (const [pid, sr] of sched.servedAt) if (sr === r) this.feeds.get(pid)!.push({ item_id: 'ad', kind: 'ad', delivered_round: r, via: null });
    for (const ev of this.liveEvents()) {
      if (ev.round !== r || this.events.some((e) => e.id === ev.id)) continue;
      this.events.push(ev);
      this.world.logEvent(ev, this.roundMs(r));
      agentLog({ run_id: this.spec.run_id, agent_name: 'Orchestrator', action: 'event_delivered', target_agent: 'CrowdAgent', status: 'success', input_summary: `${this.worldId} round ${r}, target ${ev.target}`, output_summary: ev.text.slice(0, 120), refs: { event_id: ev.id, world: this.worldId } });
      for (const p of this.base.personas) {
        if (ev.target !== 'all' && p.role !== ev.target) continue;
        this.feeds.get(p.id)!.push({ item_id: ev.id, kind: 'event', delivered_round: r, via: null, text: ev.text });
      }
    }
    // 2. wake + idle rule: only awake agents with something new in their feed cost a call
    const active = [...sched.awake[r]].sort().filter((id) => this.feeds.get(id)!.some((it) => it.delivered_round <= r));
    const turns: AgentTurn[] = active.map((id) => {
      const visible = this.feeds.get(id)!.filter((it) => it.delivered_round <= r).slice(0, 3);
      const mem = this.memories.get(id)!;
      return { persona: this.personas.get(id)!, items: visible, memories: mem.recall(`${this.post.business} post ${this.post.text}`, 3), seenBefore: this.seen.get(id) ?? 0 };
    });
    // 3. batched calls
    const batches: AgentTurn[][] = [];
    for (let i = 0; i < turns.length; i += this.spec.batchSize) batches.push(turns.slice(i, i + this.spec.batchSize));
    const hl = this.label(r);
    const results = await Promise.all(batches.map((b) => decideBatch(b, {
      post: this.post, place: this.spec.place, hourLabel: hl, worldNote: carry || 'The post just started running.',
      topComments: (a) => this.topComments(a),
      eventText: (iid) => this.events.find((e) => e.id === iid)?.text ?? '',
      mode: this.spec.mode,
    }, `${this.spec.run_id}`)));
    this.calls += batches.length;
    // per-batch CrowdAgent results go to the trace file only (many per round)
    batches.forEach((b, bi) => agentLog({
      run_id: this.spec.run_id, agent_name: 'CrowdAgent', action: 'decide_batch', target_agent: 'Guard', quiet: true, status: results[bi].repaired ? 'fallback' : 'success',
      served_by: results[bi].served_by, input_summary: `${this.worldId} round ${r}: ${b.length} people`, output_summary: `${results[bi].decisions.size} decisions${results[bi].repaired ? ', schema repair or missing decisions' : ''}`,
      refs: { world: this.worldId, round: r, batch: bi, repaired: results[bi].repaired },
    }));
    const guardHits: Record<string, number> = {};
    let guardN = 0;
    // 4. apply decisions in a fixed order
    const deliveries: { from: string; to: string; item: FeedItem }[] = [];
    const otherPost = this.spec.posts.find((p) => p.variant !== this.post.variant)?.text ?? '';
    const eventTexts = this.events.filter((e) => e.round <= r).map((e) => e.text);
    batches.forEach((batch, bi) => {
      const res = results[bi];
      const batchReasons = new Set<string>();
      for (const t of batch) {
        const p = t.persona;
        for (const it of t.items) {
          const d = res.decisions.get(`${p.id}/${it.item_id}`);
          const repaired = !d || res.repaired;
          const g = guardDecision({
            action: d?.action ?? 'scroll_past', feeling: clamp(Math.round(d?.feeling ?? 0), -2, 2), would_visit: Boolean(d?.would_visit),
            reason: (d?.reason ?? '').trim(), text: (d?.text ?? '').trim(), itemKind: it.kind,
            firstExposure: (this.seen.get(p.id) ?? 0) === 0, postText: this.post.text, otherPostText: otherPost, eventTexts, voice: p.voice, batchReasons,
          });
          for (const c of g.checks) { guardHits[c] = (guardHits[c] ?? 0) + 1; guardN++; }
          let action: ActionType = g.action;
          const feeling = g.feeling;
          let text = g.text;
          let unsaid = '';
          // private stance vs public expression: the speak gate (same draw in both twin worlds)
          if (VOCAL.has(action)) {
            const pSpeak = clamp(p.speak_p * (1 + Math.abs(feeling)) * 1.5, 0.05, 0.95);
            if (hashU(this.base.seed, p.id, it.item_id, r) > pSpeak) {
              unsaid = text; text = '';
              action = feeling > 0 ? 'like' : 'scroll_past';
            }
          } else if (text && this.spec.mode !== 'backtest' && (action === 'scroll_past' || action === 'like') && Math.abs(feeling) >= 2) {
            // the model wrote what this person would say; their own propensity to speak decides if it is posted
            // (same hash draw in both twin worlds). Otherwise it is kept private and counted as unsaid.
            if (hashU(this.base.seed, p.id, it.item_id, r, 'comment') < p.speak_p) action = 'comment';
            else { unsaid = text; text = ''; }
          } else text = '';
          const prev = this.stance.get(p.id) ?? 0;
          const next = rnd(clamp(prev + p.susceptibility * (feeling / 2 - prev), -1, 1), 3);
          this.stance.set(p.id, next);
          // a defaulted (missing) decision keeps the person's earlier intent instead of resetting it to false
          const prevIntent = this.intent.get(p.id) ?? false;
          const wouldVisit = this.spec.mode === 'backtest' ? false : d ? g.would_visit : prevIntent;
          // event items may change the intent of people who already decided on the post (e.g. a competitor's deal)
          if (d && (it.kind !== 'event' || this.deciders.has(p.id))) this.intent.set(p.id, wouldVisit);
          if (it.kind !== 'event') { this.deciders.add(p.id); this.exposures++; this.seen.set(p.id, (this.seen.get(p.id) ?? 0) + 1); }

          const what = it.kind === 'event' ? `saw news: "${it.text}"` : it.kind === 'share' ? `saw @${it.via} share ${this.post.business}'s post` : `saw ${this.post.business}'s sponsored post "${this.post.text.slice(0, 80)}"`;
          const memText = `${hl}: ${what}. I ${action.replace('_', ' ')}${text ? ` and wrote "${text}"` : ''}${unsaid ? ` (thought "${unsaid}" but kept it to myself)` : ''}. Felt ${feeling > 0 ? 'positive' : feeling < 0 ? 'negative' : 'neutral'}${g.reason ? `: ${g.reason}` : ''}.`;
          const mem = this.memories.get(p.id)!;
          const usedIds = t.memories.map((m) => m.id);
          const memId = mem.remember(r, memText, [it.item_id, action]);
          const rec: ActionRecord = {
            id: `${this.worldId}:${++this.seq}`, run_id: this.spec.run_id, agent_id: p.id, world_id: this.worldId, variant: this.post.variant,
            seed: this.base.seed, hour: r, item_id: it.item_id, item_kind: it.kind, via: it.via, action, stance: next, feeling,
            would_visit: wouldVisit, reason: g.reason.slice(0, 200), text, memory_ids: [...usedIds, memId], repaired, unsaid, checks: g.checks,
          };
          this.records.push(rec);
          this.world.logAction(rec, this.roundMs(r));
          this.emit({ type: 'action', run_id: this.spec.run_id, world_id: this.worldId, record: rec });
          if (action === 'comment' && text) this.comments.push({ agent: p.id, text, round: r });
          if (action === 'share') {
            for (const f of this.base.graph.followers.get(p.id) ?? []) {
              deliveries.push({ from: p.id, to: f, item: { item_id: `sh_${p.id}_${r}_${t.items.indexOf(it)}`, kind: 'share', delivered_round: r + 1, via: p.id, caption: text } });
            }
          }
        }
        // consumed items leave the feed
        const consumed = new Set(t.items.map((i) => i.item_id));
        this.feeds.set(p.id, this.feeds.get(p.id)!.filter((i) => !consumed.has(i.item_id)));
      }
    });
    if (guardN) agentLog({ run_id: this.spec.run_id, agent_name: 'Guard', action: 'validate_decisions', target_agent: 'CrowdAgent', quiet: true, status: 'needs_revision', input_summary: `${this.worldId} round ${r}`, output_summary: `${guardN} checks fired: reasons or comments withheld, actions made coherent`, refs: { world: this.worldId, round: r, checks: guardHits } });
    // MemoryAgent (H-MEM): what this round stored and recalled
    agentLog({ run_id: this.spec.run_id, agent_name: 'MemoryAgent', action: 'hmem_round', quiet: true, status: 'success', input_summary: `${this.worldId} round ${r}`, output_summary: `${turns.reduce((n, t) => n + t.items.length, 0)} memories stored, ${turns.reduce((n, t) => n + t.memories.length, 0)} recalled for ${turns.length} people`, refs: { world: this.worldId, round: r } });
    // 5. spread
    for (const dl of deliveries) {
      this.feeds.get(dl.to)!.push(dl.item);
      this.world.logDelivery(dl.from, dl.to, dl.item.item_id, this.roundMs(r));
    }
    const c = this.counters(r);
    this.timeline.push(c);
    const nextCarry = this.carryover(r);
    this.carryovers.push(nextCarry);
    this.emit({ type: 'round', run_id: this.spec.run_id, world_id: this.worldId, counters: c, carryover: nextCarry });
    return nextCarry;
  }

  async run(): Promise<WorldResult> {
    const rounds = this.base.schedule.rounds;
    const mk = new Markovian({ chunkConfig: { maxChunks: Math.min(32, rounds), chunkSize: 2000, carryoverTokens: 256 } });
    const run = await mk.run({
      goal: `Simulate ${rounds} rounds of world ${this.worldId}`,
      reflect: false,
      abortSignal: this.abort,
      stepFn: async ({ carryover, step }) => {
        const next = await this.round(step, carryover);
        const done = step + 1 >= rounds;
        return { content: `Round ${step + 1}/${rounds} complete.\n[STATE_CHECKPOINT]\n${next}${done ? '\n[TASK_COMPLETE]' : ''}` };
      },
    });
    if (run.status === 'errored') throw new Error(`world ${this.worldId}: ${run.error}`);
    await this.world.flush();
    const counters = this.timeline[this.timeline.length - 1] ?? this.counters(0);
    this.emit({ type: 'world_done', run_id: this.spec.run_id, world_id: this.worldId, counters });
    return {
      world_id: this.worldId, variant: this.post.variant, seed: this.base.seed, records: this.records, counters, timeline: this.timeline,
      memories: this.memories, stance: this.stance, intent: this.intent, carryovers: this.carryovers,
      markovian: { status: run.status, chunks: run.chunks.length, tokensSaved: run.totalTokensSaved, efficiencyPercent: run.efficiencyPercent },
      world_events: this.world.eventCount(), base_shape: this.world.baseShape,
    };
  }
}
