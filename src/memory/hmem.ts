/**
 * Per-agent memory on the Meterless H-MEM reference engine (BUILD_PLAN §4.3).
 * Each persona in each world has its own HMEM instance on the simulated clock. The crowd prompt reads
 * from it before every decision, and interviews may cite only what is in it.
 */
import { HMEM } from '../../engines/hmem/reference/src/index.ts';

export interface MemoryLine { id: string; hour: number; text: string; tags: string[] }

export class AgentMemory {
  readonly hmem: HMEM;
  private lines: MemoryLine[] = [];
  private now = 0;
  constructor(readonly agentId: string, readonly worldId: string, readonly startMs: number, readonly hourStep = 1) {
    this.hmem = new HMEM({ clock: () => this.now, actor: agentId });
  }
  setHour(round: number) { this.now = this.startMs + round * this.hourStep * 3_600_000; }

  private byHmemId = new Map<string, MemoryLine>();

  /** Store a memory. `keepId` restores a line persisted by an earlier run so quote links stay valid. */
  remember(round: number, text: string, tags: string[], keepId?: string): string {
    this.setHour(round);
    const rec = this.hmem.add({ content: text, type: 'personal', tags, confidence: 0.9, source: `world:${this.worldId}`, provenance: { origin: 'model_response', learnedAt: this.now, label: `${this.worldId}:${this.agentId}`, refs: tags } });
    const line = { id: keepId ?? `${this.agentId}.${rec.id}`, hour: round, text, tags };
    this.lines.push(line);
    this.byHmemId.set(rec.id, line);
    return line.id;
  }

  /** H-MEM retrieval for the next decision: the most relevant earlier memories. */
  recall(q: string, topN = 3): MemoryLine[] {
    if (!this.lines.length) return [];
    const r = this.hmem.query(q, { topN, threshold: 0 });
    return r.memories.map((m) => this.byHmemId.get(m.memory.id)).filter(Boolean) as MemoryLine[];
  }

  all(): MemoryLine[] { return [...this.lines]; }
  get size() { return this.lines.length; }
}
