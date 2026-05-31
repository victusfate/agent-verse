# Plan: Autonomous Ops

Each slice cuts through all layers: schema → logic → tests.
Frontend slices (9–11) are scaffolded and structure-tested; browser verification requires a running dev server.

---

## Slice 1 — Schema additions
Add `SupervisorDecision`, `HardHalt` schemas; extend `OperatorTask.status` with `'halted'`; add `'cli'` and `'simulated'` to `LlmProviderType`.

## Slice 2 — Supervisor agent core
Implement `src/agents/supervisor.ts`: mitigate / pass / halt branches with mocked LLM. Test all three outcomes.

## Slice 3 — Supervisor hard-halt conditions
Budget-exceeded halt and destructive-action halt. Test both conditions with budget values and mock destructive classification.

## Slice 4 — Operator → Supervisor integration
Modify `src/agents/operator.ts` L2 to route `escalate_to_human` tasks to supervisor. Test mitigated task flows through to Tool; halted task returns `status: 'halted'`.

## Slice 5 — CliModel provider
Implement `src/llm/cli.ts`: subprocess spawn, stdin/stdout pipe, ANSI strip, timeout, non-zero exit throw. Add to factory. Test all failure modes.

## Slice 6 — SimulatedModel + --sim flag
Implement `src/llm/simulated.ts` + `src/simulation/fixtures.ts`. Add `--sim=fixture|cheap` to `main.ts`. Test fixture hit, fixture miss (fallback + warning), `--sim=cheap` model override.

## Slice 7 — Ledger additions
Add `queryEvents(company_id, since?, until?)` and `tailEvents(company_id, since, onRow, signal)` to `src/ledger.ts`. Export `LedgerRow` type. Test range filtering and tail delivery of new rows.

## Slice 8 — Express server + events endpoints
Implement `src/server/index.ts` and `src/server/routes/events.ts` (SSE stream + REST range). Test SSE content-type, `data:` prefix, range JSON response shape.

## Slice 9 — Express company endpoints
Implement `src/server/routes/companies.ts` and `src/server/routes/skills.ts`. Test response shapes for company listing, single company, and skills-diff.

## Slice 10 — React frontend scaffold + Live Feed
Scaffold `web/` (Vite + React). Implement three-panel layout. Live Feed panel consumes SSE stream and renders event rows. Structure test: component renders without crashing.

## Slice 11 — Timeline scrubber + drill-down
Implement scrubber controls (play/pause/rewind/seek) with client-side playhead state. Implement drill-down slide-in panel with layer rows and raw JSON toggle.

## Slice 12 — Venture View + Ledger Explorer panels
Implement Venture View (cycle progress, task cards, Supervisor log, skills diff). Implement Ledger Explorer (filterable event table). Component render tests.

## Slice 13 — CLI smoke test
Add `src/__tests__/cli-agent.smoke.ts` (skipped unless `CLI_AGENT_CMD` is set). Add `test:cli-agent` npm script.
