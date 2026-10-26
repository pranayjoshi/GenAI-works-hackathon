/** Follower graph linked by similarity with an influence-weighted long tail (BUILD_PLAN §4.4 step 6). Built before the fork. */
import type { Persona } from '../schemas/persona.js';
import { AGE_BANDS } from '../schemas/persona.js';
import { Rng } from '../util/core.js';

export interface Graph { follows: Map<string, string[]>; followers: Map<string, string[]> }

export function buildGraph(personas: Persona[], rng: Rng): Graph {
  const follows = new Map<string, string[]>();
  const followers = new Map<string, string[]>(personas.map((p) => [p.id, []]));
  const bandIdx = (p: Persona) => AGE_BANDS.indexOf(p.age_band);
  for (const p of personas) {
    const k = Math.min(personas.length - 1, Math.round(4 + rng.logNormal(Math.log(8), 0.5)));
    const weights = personas.map((q) => {
      if (q.id === p.id) return 0;
      const gap = Math.abs(bandIdx(p) - bandIdx(q));
      let w = gap === 0 ? 3 : gap === 1 ? 1.5 : 0.4;
      if (q.role === p.role) w *= 1.4;
      if (Boolean(q.customer) === Boolean(p.customer)) w *= 1.2;
      return w * Math.sqrt(q.influence);
    });
    const chosen = new Set<string>();
    for (let t = 0; t < k * 4 && chosen.size < k; t++) chosen.add(rng.weighted(personas, weights).id);
    const list = [...chosen].sort();
    follows.set(p.id, list);
    for (const q of list) followers.get(q)!.push(p.id);
  }
  return { follows, followers };
}
