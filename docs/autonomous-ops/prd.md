# PRD: Autonomous Ops

## Problem Statement

Agent-Verse today requires a human in the loop for any high/critical-risk task: the Operator logs an escalation warning and continues, but the intent is to block until a person approves. This makes unattended runs impractical for anything beyond trivial tasks. There is also no way to observe a run in progress beyond raw console output, no mechanism to replay or inspect past decisions, no cost-safe way to test the full execution pipeline, and no way to drive the system with a local CLI agent instead of a cloud API — making development and testing expensive.

## Solution

Four tightly related capabilities delivered together:

1. **Supervisor agent** — autonomous judgment layer that replaces the human gate. Attempts task mitigation; hard-halts only on budget breach or irreversible destructive action. All decisions recorded in the ledger.
2. **Observability dashboard** — local Express + React web app that streams ledger events via SSE, supports video-player-style timeline scrubbing via REST range queries, and provides drill-down into the full 5-layer operator stack per event.
3. **Simulation modes** — `--sim=fixture` (deterministic, zero-cost) and `--sim=cheap` (cheap model, realistic variance) for testing the full pipeline without burning production credits.
4. **CliModel provider** — generic subprocess `Model` implementation for running any CLI agent (Claude Code, Aider, etc.) as the LLM backend, with a local smoke test.

## User Stories

1. As an operator, I want to start a multi-cycle venture run and walk away, so that agent-verse completes autonomously without waiting for my approval at every escalation.
2. As an operator, I want the Supervisor to attempt scope reduction or task splitting before giving up, so that fewer tasks hard-halt and more work gets done per run.
3. As an operator, I want hard-halts to trigger only when the budget ceiling is about to be breached or an irreversible destructive action is detected, so that the system stops at a meaningful safety boundary, not an arbitrary one.
4. As an operator, I want every Supervisor decision (mitigate, pass, halt) logged to the ledger with full reasoning, so that I can audit what happened without being present.
5. As an observer, I want to open a web dashboard and see a live feed of agent events as they arrive, so that I can monitor a run in real time without parsing console output.
6. As an observer, I want to seek backward and forward through the event timeline like a video player, so that I can replay and study the sequence of decisions after a run completes.
7. As an observer, I want the seek bar to show event density and pin milestones (cycle start, hard halt, completion), so that I can jump directly to significant moments.
8. As an observer, I want to double-click or right-click any event and drill into its full 5-layer operator stack, so that I can see exactly what the Sensor ingested, what Policy decided, what Tool produced, what the Quality Gate flagged, and what Learning recorded.
9. As an observer, I want a raw JSON toggle on every payload in the drill-down, so that I can inspect exact data without reformatting.
10. As an observer, I want a Venture View panel showing cycle progress, task status cards, Supervisor decision log, and a skills.md diff per cycle, so that I can understand per-company progress at a glance.
11. As an observer, I want a Ledger Explorer panel with a filterable, searchable event table, so that I can find specific events across companies and time ranges.
12. As a developer, I want to run `--sim=fixture` and get a fully deterministic end-to-end execution at zero API cost, so that I can run CI and snapshot tests reliably.
13. As a developer, I want fixture responses keyed by agent role and layer with a fallback for missing keys, so that I can add or omit fixtures incrementally without breaking the whole run.
14. As a developer, I want to run `--sim=cheap` to route all LLM calls through a configurable cheap model, so that I can test realistic LLM variance at low cost.
15. As a developer, I want to run `--model=cli:claude` (or any CLI agent command) and have the system pipe prompts through that subprocess, so that I can use a local CLI agent as the LLM backend without code changes.
16. As a developer, I want `npm run test:cli-agent` to run a full 5-layer operator smoke test against my local CLI agent, so that I can verify the integration works end-to-end on my machine.
17. As a developer, I want the CLI agent timeout to be configurable via `CLI_MODEL_TIMEOUT_MS`, so that slow agents don't cause spurious failures.
18. As a developer, I want ANSI codes stripped from CLI agent output automatically, so that styled terminal output from agents like Claude Code doesn't break JSON parsing.

## Implementation Decisions

### New schemas (`src/schemas.ts`)
- Add `SupervisorDecisionSchema`: `{ task_id, action: 'mitigate'|'pass'|'halt', reason, mitigated_task?: OperatorTask, estimated_cost_usd: number }`
- Add `HardHaltSchema`: `{ company_id, task_id, reason: 'budget_exceeded'|'destructive_action', detail: string }`
- Extend `OperatorTask.status` enum with `'halted'`
- Add `'cli'` and `'simulated'` to `LlmProviderType`

### Supervisor agent (`src/agents/supervisor.ts`)
- Invoked by Operator L2 when `policy.escalate_to_human === true`
- Reads `context_framework.json` for `token_budget_usd` and `tokens_consumed_usd`
- Makes one LLM call: system prompt describes mitigation options; returns `SupervisorDecision`
- Budget check: if `tokens_consumed_usd + estimated_cost_usd > token_budget_usd` → `halt` with `reason: 'budget_exceeded'`
- Destructive check: Supervisor LLM classifies the task against a fixed irreversibility criteria list → `halt` with `reason: 'destructive_action'`
- On `mitigate`: returns modified `OperatorTask` with lowered `risk_tier`; Operator continues with mitigated task
- On `pass`: Operator continues with original task unchanged
- On `halt`: records `HardHalt` to ledger; Operator returns task with `status: 'halted'`
- The Supervisor is the authoritative budget enforcer; Policy L2 uses budget only for `risk_tier` estimation

### Operator modification (`src/agents/operator.ts`)
- L2 branch: when `policy.escalate_to_human === true`, call `supervisor.evaluate(task)` instead of logging and continuing
- If Supervisor returns `halt` → return task with `status: 'halted'`
- If Supervisor returns `mitigate` → replace `task` with `decision.mitigated_task` and continue to L3
- If Supervisor returns `pass` → continue to L3 unchanged

### CliModel provider (`src/llm/cli.ts`)
- Implements `Model` interface; `provider: 'cli'`, `id` is the raw command string
- `generate()`: spawns subprocess via `child_process.spawn`, writes `${systemInstruction}\n\n${prompt}` to stdin, closes stdin, collects stdout until exit
- Strips ANSI escape codes (regex: `/\x1B\[[0-9;]*[A-Za-z]/g`) and trims whitespace
- Throws on non-zero exit code; throws on timeout (default 60 000 ms, `CLI_MODEL_TIMEOUT_MS`)
- `detectProvider`: prefix `cli:` maps to `'cli'`; `stripProviderPrefix` strips `cli:` prefix to get the command

### SimulatedModel provider (`src/llm/simulated.ts`)
- Implements `Model` interface; `provider: 'simulated'`, `id: 'fixture'`
- Fixture file: `src/simulation/fixtures.ts` — exported map `Record<string, string>` keyed by `${agentRole}:${layer}` (e.g. `'product:tool'`, `'idea:generate'`)
- `generate()`: looks up key derived from system instruction content, returns fixture JSON string; if no match, returns a generic valid fallback fixture and logs a warning to stderr
- `--sim=fixture` → `createModel` returns `SimulatedModel`
- `--sim=cheap` → `createModel` uses `CHEAP_MODEL` env var (default `claude-haiku-4-5-20251001`) as model ID, routes through existing provider detection

### Factory updates (`src/llm/index.ts`)
- `detectProvider`: add `cli:` prefix → `'cli'`; add `simulated` literal → `'simulated'`
- `createModel`: add `'cli'` case → `new CliModel(id)`; add `'simulated'` case → `new SimulatedModel()`
- `main.ts`: parse `--sim=fixture|cheap`; if `fixture`, set `AGENT_MODEL=simulated`; if `cheap`, set `AGENT_MODEL` to `CHEAP_MODEL` env var value

### Ledger additions (`src/ledger.ts`)
- `queryEvents(company_id: string, since?: number, until?: number): LedgerRow[]` — returns rows filtered by integer `id` range; used by REST range endpoint and Ledger Explorer
- `tailEvents(company_id: string, since: number, onRow: (row: LedgerRow) => void, signal: AbortSignal): void` — polls `SELECT` every 500 ms and calls `onRow` for new rows; used by SSE endpoint; stops when `signal` is aborted
- Export `LedgerRow` type: `{ id: number; ts: string; company_id: string; event_type: string; agent_type: string | null; payload: unknown }`

### Dashboard server (`src/server/`)
- `src/server/index.ts` — Express app entry; mounts routes; started via `npm run dashboard`
- `src/server/routes/events.ts`:
  - `GET /events/stream?company_id=<id>&since=<id>` — SSE; calls `tailEvents`; sends `data: <json>\n\n` per row; closes on client disconnect (AbortController)
  - `GET /events?company_id=<id>&since=<id>&until=<id>` — returns `queryEvents` result as JSON array
- `src/server/routes/companies.ts`:
  - `GET /companies` — lists directories in `companies/`
  - `GET /companies/:id` — returns `context_framework.json` + latest `skills.md` + task summary from `task_log.jsonl`
- `src/server/routes/skills.ts`:
  - `GET /companies/:id/skills-diff` — returns an array of `{ cycle, diff }` objects from `task_log.jsonl` entries that include `skills_update`

### Dashboard frontend (`web/`)
- Separate Vite + React app in `web/`; proxies API calls to Express server in dev via Vite config
- Three panels: Live Feed, Venture View, Ledger Explorer
- Timeline scrubber: React state `{ playhead: number, playing: boolean, events: LedgerRow[] }`; seek fires `GET /events?since=X&until=Y`; play advances playhead at 1× speed using `requestAnimationFrame` over event timestamps; pause freezes playhead while SSE continues buffering
- Drill-down: click any event row → slide-in `<aside>` showing parsed `payload.data` grouped by layer; raw JSON toggle per layer
- `package.json` scripts: `npm run dashboard` starts Express; `npm run web` starts Vite dev server; `npm run build:web` builds frontend to `web/dist/` which Express serves in production

### CLI smoke test
- `src/__tests__/cli-agent.smoke.ts` — skipped unless `CLI_AGENT_CMD` env var is set; runs one full Operator task through `CliModel`; asserts task status is `completed` or `failed` (not `halted` or `blocked`)
- `package.json` script: `"test:cli-agent": "CLI_AGENT_CMD=${CLI_AGENT_CMD:-claude} vitest run src/__tests__/cli-agent.smoke.ts"`

## Testing Decisions

**What makes a good test here:**
- Supervisor tests must cover the three outcome branches (mitigate, pass, halt) and both halt reasons (budget, destructive), all with mocked LLM
- CliModel tests must cover: successful round-trip, non-zero exit code throws, timeout throws, ANSI stripping
- SimulatedModel tests must cover: fixture hit, fixture miss (fallback + warning), determinism (same input → same output)
- Ledger tests must cover: `queryEvents` with and without `since`/`until` bounds, `tailEvents` delivering new rows after initial call
- SSE route test: verifies `text/event-stream` content-type and `data:` prefix on rows

**Modules with tests:**
- `src/agents/supervisor.ts` (new, complex logic, safety-critical)
- `src/llm/cli.ts` (new, subprocess I/O, failure modes)
- `src/llm/simulated.ts` (new, fixture lookup)
- `src/ledger.ts` (additions to existing tested module)
- `src/server/routes/events.ts` (new, SSE format correctness)
- `src/__tests__/cli-agent.smoke.ts` (local-only smoke test)

**Prior art:**
- `src/__tests__/operator.test.ts` — LLM mock pattern via `vi.mock('../llm/index.js')`
- `src/__tests__/ledger.test.ts` — in-memory SQLite setup pattern
- `src/__tests__/llm.detectProvider.test.ts` — provider detection assertions

## Out of Scope

- WebSocket bidirectional control (dashboard → graph commands)
- Authentication/authorization for the deployed dashboard
- Multi-user concurrent dashboard sessions
- Mobile dashboard layout
- Persistent fixture library management UI
- Dashboard CI deployment pipeline
- Skills.md visual editor in the dashboard
- Supervisor override from the dashboard UI

## Further Notes

- The `web/` directory introduces a second `package.json`; a root `npm run build` script should build both
- The `tailEvents` polling interval (500 ms) is a pragmatic choice; a proper SQLite WAL change notification would be cleaner but requires native bindings
- `--sim=cheap` with `CHEAP_MODEL=ollama/llama3` gives zero-cost robustness testing when Ollama is running locally — worth calling out in the README
- The dashboard's `skills.md` diff viewer needs a diff library (`diff` npm package); this is the only new runtime dependency for the frontend
