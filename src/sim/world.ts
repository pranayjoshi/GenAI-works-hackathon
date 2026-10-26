/**
 * The shared world on the Meterless World Model engine (BUILD_PLAN §4.1).
 * Base log = people, follower edges and the schedule fingerprint. Twin worlds are forks: each replays the
 * identical base writes into its own namespace, then appends only its own post and ad_served facts.
 * Everything after that (actions, share deliveries, injected events) is appended as the run happens.
 */
import { WorldModel } from '../../engines/world-model/reference/src/index.ts';
import type { Persona } from '../schemas/persona.js';
import type { ActionRecord } from '../schemas/action.js';
import type { Graph } from './graph.js';
import type { Schedule } from './schedule.js';
import type { InjectedEvent, Post } from './types.js';
import { sha } from '../util/core.js';

type Op = { kind: 'entity' | 'relate' | 'fact'; input: any };

export interface BaseWorld {
  seed: number;
  personas: Persona[];
  graph: Graph;
  schedule: Schedule;
  ops: Op[];
  startMs: number;
  fingerprint: string;   // hash of the base ops: identical for every fork of this seed
}

const iso = (ms: number) => new Date(ms).toISOString();

export function buildBase(seed: number, personas: Persona[], graph: Graph, schedule: Schedule, startMs: number): BaseWorld {
  const at = iso(startMs);
  const src = { kind: 'pipeline', by: 'dryrun-base', at };
  const ops: Op[] = [];
  for (const p of personas) {
    ops.push({ kind: 'entity', input: { type: 'person', externalKey: { system: 'dryrun', id: p.id }, name: p.id, attrs: { age_band: p.age_band, role: p.role, segment: p.segment, influence: p.influence }, source: src } });
  }
  for (const [from, list] of graph.follows) for (const to of list) {
    ops.push({ kind: 'relate', input: { from: `person:${from}`, type: 'follows', to: `person:${to}`, source: src } });
  }
  const sched = {
    hours: schedule.hours,
    awake: schedule.awake.map((s) => [...s].sort()),
    served: [...schedule.servedAt.entries()].sort(),
  };
  ops.push({ kind: 'fact', input: { about: `person:${personas[0].id}`, predicate: 'schedule_fingerprint', value: sha(JSON.stringify(sched), 32), source: src } });
  const fingerprint = sha(JSON.stringify(ops.map((o) => [o.kind, o.input.externalKey?.id ?? o.input.from ?? o.input.about, o.input.to ?? o.input.value ?? ''])), 32);
  return { seed, personas, graph, schedule, ops, startMs, fingerprint };
}

export class SimWorld {
  readonly wm: WorldModel;
  private idOf = new Map<string, string>();
  private pending: Promise<unknown>[] = [];
  baseShape = '';

  private constructor(readonly worldId: string, readonly base: BaseWorld, readonly post: Post) {
    this.wm = new WorldModel({ namespace: worldId, storage: 'memory', clock: () => new Date(base.startMs) });
  }

  /** Fork: replay the identical base writes, record the base shape, then append this world's post. */
  static async fork(worldId: string, base: BaseWorld, post: Post): Promise<SimWorld> {
    const w = new SimWorld(worldId, base, post);
    for (const op of base.ops) {
      if (op.kind === 'entity') {
        const e = await w.wm.upsertEntity(op.input);
        w.idOf.set(op.input.externalKey.id, e.id);
      } else if (op.kind === 'relate') {
        await w.wm.relate({ ...op.input, from: w.idOf.get(op.input.from.slice(7))!, to: w.idOf.get(op.input.to.slice(7))! });
      } else {
        await w.wm.assertFact({ ...op.input, about: w.idOf.get(op.input.about.slice(7))! });
      }
    }
    w.baseShape = sha(w.wm.stateShapeCanonical(), 32);
    const at = iso(base.startMs);
    const postEntity = await w.wm.upsertEntity({ type: 'post', name: 'sponsored-post', attrs: { variant: post.variant, text: post.text, business: post.business }, source: { kind: 'manual', by: 'dryrun-user', at } });
    for (const [pid, round] of [...base.schedule.servedAt.entries()].sort()) {
      w.pending.push(w.wm.assertFact({ about: w.idOf.get(pid)!, predicate: 'ad_served', value: { round, post: postEntity.id }, source: { kind: 'pipeline', by: 'ad-server', at: iso(base.startMs + round * 3_600_000) } }));
    }
    return w;
  }

  logAction(r: ActionRecord, roundMs: number) {
    const at = iso(roundMs);
    this.pending.push(this.wm.assertFact({ about: this.idOf.get(r.agent_id)!, predicate: 'action', value: { id: r.id, item: r.item_id, action: r.action, stance: r.stance, would_visit: r.would_visit }, source: { kind: 'agent', by: r.agent_id, at } }));
  }
  logDelivery(from: string, to: string, itemId: string, roundMs: number) {
    this.pending.push(this.wm.relate({ from: this.idOf.get(from)!, type: 'delivered', to: this.idOf.get(to)!, attrs: { item: itemId }, validFrom: iso(roundMs), source: { kind: 'agent', by: from, at: iso(roundMs) } }));
  }
  logEvent(ev: InjectedEvent, roundMs: number) {
    this.pending.push(this.wm.upsertEntity({ type: 'event', name: ev.id, attrs: { text: ev.text, target: ev.target, round: ev.round }, source: { kind: 'manual', by: 'dryrun-user', at: iso(roundMs) } }));
  }
  async flush() { await Promise.allSettled(this.pending); this.pending = []; }
  eventCount() { return this.wm.events().length; }
}
