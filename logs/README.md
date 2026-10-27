# Agent trace

Written during every run by `src/util/agentlog.ts`; these files are gitignored except this README.

- `logs/agent-trace.jsonl`: every event, all runs.
- `logs/<run_id>.jsonl`: the same events for one run (when the event carries `run_id`).
- stdout: one compact line per event, e.g. `[ReportCritic -> ReportWriter] critique needs_revision: 2 code issues (model ... via ...)`. Set `QUIET_AGENT_LOG=true` to silence it. Per-model-call (`ModelRouter`) and per-crowd-batch (`CrowdAgent`) lines go to the files only.
- `LOGS_DIR` overrides the directory.

Each line is JSON: `ts, run_id?, agent_name, action, target_agent?, input_summary?, output_summary?, model?, served_by?, confidence?, retry_count?, status, ms?, refs?`.
`status` is `started | success | needs_revision | fallback | error | info`.

Agents: Orchestrator, AudienceAgent, DataAgent (each Zetaris/DuckDB query: engine, row_count, query_id), VoiceWriter, CrowdAgent, Guard, MemoryAgent (H-MEM), ReportWriter, ReportCritic (code checks, model critique, revision), DecisionAgent, VersionCWriter, HonestyCheck, LaunchAgent, Interviewer, ModelRouter (request, model, served_by, tokens, repair retry).
Every line is emitted by the code that did the thing; replayed model calls show `served_by: replay(...)`.
