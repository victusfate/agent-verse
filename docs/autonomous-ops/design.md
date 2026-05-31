# Design: Autonomous Ops

## Canonical Vocabulary

| Term | Definition |
|---|---|
| **Supervisor agent** | Automated agent that replaces the human gate; evaluates high/critical-risk tasks, applies mitigations, and emits hard-halt events only on budget or destructive-action breaches |
| **Hard halt** | Unconditional stop emitted by the Supervisor when `token_budget_usd` is exceeded or a task is classified as irreversibly destructive |
| **Mitigation** | Supervisor action that modifies a task (reduce scope, split, reframe) to lower its risk tier before passing it to the Operator |
| **Observability dashboard** | Local web app (Express + Vite + React) that streams and replays ledger events; API-first for future remote deployment |
| **SSE stream** | Server-Sent Events endpoint (`/events/stream`) that tails the SQLite ledger and pushes new rows to the dashboard in real time; used for the live edge only |
| **Range query** | REST `GET /events?since=&until=` that returns a bounded batch of ledger rows; used by the scrubber when seeking or rewinding |
| **Client-side playhead** | React state tracking the current replay position; play/pause/rewind are local operations — the server holds no playhead state |
| **Timeline scrubber** | Dashboard control for playing, pausing, rewinding, and seeking through the ledger event log as if it were a video |
| **Drill-down** | Double-click or right-click on any event to expand the full 5-layer operator stack (sensor → policy → tool → quality gate → learning) with raw payloads |
| **Fixture simulation** | `SimulatedModel` implementing the `Model` interface; returns scripted JSON keyed by agent role and layer — deterministic, zero-cost, used for eval and CI |
| **Cheap-model simulation** | Routes all LLM calls through a configurable low-cost model (e.g. Haiku, local Ollama); realistic variance for robustness testing |
| **CliModel** | `Model` implementation that spawns a subprocess, pipes the prompt to stdin, and reads the response from stdout; configured via `--model=cli:<command>` |

---

## Decisions

### 1. Human gate → Supervisor agent

**Decision:** Replace `escalate_to_human` with an autonomous Supervisor agent that sits between Policy and Tool layers for high/critical tasks.

**Behaviour:**
- Receives the task and Policy decision when `escalate_to_human: true`
- Attempts mitigation: scope reduction, task splitting, or constraint relaxation
- If mitigated successfully, passes the modified task back to Layer 3 (Tool)
- Emits a **hard halt** only if:
  1. Cumulative spend (`tokens_consumed_usd`) would exceed `token_budget_usd`, or
  2. The task description contains an irreversibly destructive action (deleting production data, publishing to real external users, etc.)
- All Supervisor decisions — mitigate, pass, or halt — are recorded in the ledger

**Rationale:** The goal is a fully headless, autonomous system. The budget ceiling is the primary safety mechanism. The Supervisor replaces a synchronous human with an automated judgment layer, making long unattended runs viable.

**Alternatives considered:**
- Hard halt on any CRITICAL tier (too conservative, frequent halts on tasks the Supervisor could safely handle)
- Remove escalation entirely (loses the risk-differentiation signal that powers observability)

---

### 2. Observability surface → Web dashboard

**Decision:** Build a local Express + Vite + React web dashboard.

**Design constraints:**
- API-first: all data served via REST + SSE so the same backend can be deployed remotely later
- Graph and dashboard are fully decoupled — graph writes to ledger, dashboard is a pure reader
- Dashboard server runs as a separate process; `--watch` flag or `npm run dashboard` to start

**Three-panel layout:**
1. **Live Feed** — real-time SSE event stream; each row shows timestamp, company, agent, event type
2. **Venture View** — per-company: cycle progress ring, task status cards, Supervisor decision log, skills.md diff viewer
3. **Ledger Explorer** — filterable/searchable table of all ledger events with JSON payload drill-down

**Timeline scrubber:**
- Play/pause/rewind/seek across the full event log
- Scrubbing replays events into the UI in order (no re-querying the LLM)
- Seek bar shows event density over time; milestones (cycle start, hard halt, completion) are pinned

**Drill-down:**
- Double-click or right-click any event → slide-in panel showing full 5-layer stack
- Each layer row is expandable: shows input context, LLM prompt/response, output, errors
- Raw JSON toggle for every payload

**Rationale:** Web dashboard matches the deployment ambition. Three panels separate live monitoring from historical review. Scrubber makes post-run analysis feel native rather than log-grepping.

**Alternatives considered:**
- TUI (no deployment path, limited interaction model)
- JSON streaming to stdout (useful as a secondary output, not a replacement)

---

### 3. Dashboard data flow → SSE + REST

**Decision:** Express server exposes two read paths; the dashboard combines them for all interactions.

**SSE endpoint:** `GET /events/stream?company_id=<id>&since=<event_id>`
- Tails the ledger and pushes new rows to the client as they are inserted
- `since` parameter enables resume after disconnect without replaying the full history
- Used for live-tail mode (playhead at the current edge)

**REST range endpoint:** `GET /events?company_id=<id>&since=<event_id>&until=<event_id>`
- Returns a bounded batch of ledger rows for a requested time range
- Used by the scrubber when seeking or rewinding: client fires a range request, buffers the rows, replays them locally in order
- No server-side playhead state; the server is a pure reader of the immutable ledger

**Client-side playhead:** play/pause/rewind are local state in the React client. Pause buffers incoming SSE rows without advancing the display. Rewind fetches a historical range via REST and replays it. The server is never told where the playhead is.

**Why not WebSockets:** bidirectionality would only pay off if the dashboard needed to send commands that affect the running graph (e.g. trigger a new run, override a Supervisor decision). That is out of scope. SSE + REST keeps the server stateless and deployment simple.

**Rationale:** The ledger is an immutable log — any segment is independently queryable. Client-side playhead state is sufficient; no session or streaming protocol overhead needed beyond SSE for the live edge.

---

### 4. Simulation modes → Fixture + Cheap-model

**Decision:** Two named simulation modes, both activated via `--sim=<mode>`.

**`--sim=fixture`:**
- `SimulatedModel` class implements `Model` interface
- Returns canned JSON responses keyed by `{ agentRole, layer }` from a fixtures file
- Deterministic: same seed → same outputs every run
- Zero cost, zero network; used for CI, eval harnesses, snapshot tests

**`--sim=cheap`:**
- Overrides the configured model with a cheaper fallback (`CHEAP_MODEL` env var, default `claude-haiku-4-5-20251001`)
- Full LLM call path, real variance, real (low) cost
- Used for robustness and end-to-end integration testing

**Rationale:** Deterministic fixtures give reliable eval baselines. Cheap-model runs exercise the full code path with realistic LLM variance. The existing local Ollama provider already covers zero-cost LLM simulation; `--sim=cheap` routes through it transparently when `CHEAP_MODEL=ollama/llama3`.

---

### 5. Local CLI agent → CliModel subprocess provider

**Decision:** Add a `CliModel` class in `src/llm/cli.ts` implementing the `Model` interface.

**Interface:**
- Configured via `--model=cli:<command>` (e.g. `--model=cli:claude`, `--model=cli:aider`)
- Spawns a subprocess with the command, writes `<system>\n\n<prompt>` to stdin, reads stdout as the response
- Strips ANSI escape codes and trims whitespace from output
- Timeout configurable via `CLI_MODEL_TIMEOUT_MS` env var (default 60 000 ms)

**Local smoke test:**
- `npm run test:cli-agent` — runnable locally, configurable via `CLI_AGENT_CMD` env var
- Exercises the full 5-layer operator stack with a single task using the CLI provider
- Skipped in CI unless `CLI_AGENT_CMD` is set

**Rationale:** Generic subprocess interface works with any CLI agent (Claude Code, Aider, sgpt, llama.cpp with a wrapper) without special-casing. Follows the existing provider factory pattern — zero changes needed in agent code.

---

### 6. Supervisor hard-halt criteria

**Decision:** The Supervisor agent emits a hard halt only under two conditions:

1. **Budget breach:** `tokens_consumed_usd + estimated_task_cost > token_budget_usd`
2. **Irreversible destructive action:** the Supervisor's LLM call returns `destructive: true` after evaluating the task against a fixed set of irreversibility criteria (delete production data, send real communications to users, charge real payment methods, modify live infrastructure); this is a judgment call by the Supervisor model, not keyword matching

Everything else is handled via mitigation. The Supervisor may pass tasks with elevated risk if mitigation brings them to LOW or MEDIUM.

**Fixed budget as primary safety mechanism:** the `token_budget_usd` field in `context_framework.json` is the single dial that controls how far an autonomous run goes. The Supervisor is the authoritative budget enforcer — it checks `tokens_consumed_usd + estimated_task_cost > token_budget_usd` before passing any task to the Tool layer. The Policy layer (L2) does a preliminary budget estimation only to set `risk_tier`; it does not halt. When the Supervisor halts on budget, all agents stop cleanly and final state is committed to the ledger.

**Rationale:** The user's explicit goal is to observe what a fully unsupervised system does within a bounded envelope. Conservative halt criteria defeat that purpose. Budget exhaustion is a clean, observable, non-destructive terminal condition.

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Supervisor mitigates a task but mitigated version still scores CRITICAL | Hard halt — logged with full mitigation chain |
| CLI agent process exits non-zero | `CliModel` throws; Operator L3 catches and marks task failed; ledger records error |
| SSE client disconnects mid-scrub | Client reconnects with `since=<last_event_id>` (integer row id from ledger); no state lost |
| `--sim=fixture` missing a fixture for a role/layer | `SimulatedModel` returns a generic fallback fixture and logs a warning |
| Budget exhausted mid-cycle | Supervisor halts; completed tasks in that cycle are committed; incomplete tasks marked `halted` |
| Dashboard launched before any run exists | Shows empty state with "No ventures yet" and a getting-started command |

---

## Out of Scope

- WebSocket bidirectional control (dashboard → graph commands)
- Authentication/authorization for the deployed dashboard
- Persistent fixture library management UI
- Multi-user concurrent dashboard sessions
- Mobile dashboard layout
