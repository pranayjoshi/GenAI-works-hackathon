/**
 * Agent trace: one JSONL line per real agent action, to logs/agent-trace.jsonl, logs/<run_id>.jsonl (when run_id is set)
 * and, unless QUIET_AGENT_LOG=true or `quiet`, one compact line on stdout. Format in logs/README.md.
 * Callers log what their code path actually did; nothing here invents events.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface AgentEvent {
  run_id?: string;
  agent_name: string;
  action: string;
  target_agent?: string;
  input_summary?: string;
  output_summary?: string;
  model?: string;
  served_by?: string;
  confidence?: number;
  retry_count?: number;
  status: 'started' | 'success' | 'needs_revision' | 'fallback' | 'error' | 'info';
  ms?: number;
  refs?: Record<string, unknown>;
  /** file only: skip the stdout line (per-call crowd and model lines) */
  quiet?: boolean;
}

let ready: string | null = null;
function dir(): string {
  const d = path.resolve(process.env.LOGS_DIR || 'logs');
  if (ready !== d) { try { fs.mkdirSync(d, { recursive: true }); ready = d; } catch { /* best effort */ } }
  return d;
}

export function agentLog(e: AgentEvent): void {
  const { quiet, ...rest } = e;
  const line = JSON.stringify({ ts: new Date().toISOString(), ...rest });
  try {
    const d = dir();
    fs.appendFileSync(path.join(d, 'agent-trace.jsonl'), line + '\n');
    if (e.run_id) fs.appendFileSync(path.join(d, `${e.run_id.replace(/[^\w.-]/g, '_')}.jsonl`), line + '\n');
  } catch { /* logging never breaks a run */ }
  if (quiet || process.env.QUIET_AGENT_LOG === 'true') return;
  const route = e.target_agent ? `${e.agent_name} -> ${e.target_agent}` : e.agent_name;
  const via = e.model ? ` (model ${e.model}${e.served_by ? ` via ${e.served_by}` : ''})` : e.served_by ? ` (via ${e.served_by})` : '';
  const retry = e.retry_count ? ` [retry ${e.retry_count}]` : '';
  const detail = e.output_summary ?? e.input_summary;
  console.log(`[${route}] ${e.action} ${e.status}${detail ? `: ${detail}` : ''}${via}${retry}${e.ms !== undefined ? ` ${e.ms}ms` : ''}`);
}
