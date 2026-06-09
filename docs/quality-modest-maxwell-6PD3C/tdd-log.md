# TDD Log: Quality Rework

Baseline: 113 tests passing, `npm run typecheck` FAILING (TS2345 ×2).
Final: 164 root tests + 24 web tests passing, typecheck green, `vite build` green,
simulated end-to-end run green.

## Slice 1 — Injectable ledger + unified path anchoring (F-05, F-09, F-16, F-21, F-42)
- Status: done
- `createLedger(dbPath)` handle + lazy default; `resolveCompaniesDir()` (COMPANIES_DIR env
  override) shared by ledger/brain/server; typed `FailureRow` (payload as field); tail abort
  clears its timer; dead wrappers and `*FromDb` duals removed; typecheck fixed.
- ledger.test.ts now tests the real module (70-line clone deleted); chdir choreography
  replaced by COMPANIES_DIR in 5 test files.

## Slice 2 — GenerateResult contract + provider hardening (F-11, F-13, F-14, F-25, F-26, F-32)
- Status: done
- `generate → { text, usage? }` across all providers; LocalModel merged into configurable
  OpenAIModel; o-series params; constructor key checks; truncation/empty errors; brace
  repair only in parseModelJson (and only when the tail looks like JSON); explicit ids
  bypass AGENT_PROVIDER; createModel memoized; CLI SIGTERM→SIGKILL.

## Slice 3 — Explicit fixture keys (F-02)
- Status: done
- fixtureKey routing; unknown/missing keys throw; keyword tables deleted; monitor fixture
  reshaped to the prompted schema. New simulation.e2e test proves `AGENT_MODEL=simulated`
  completes the full graph (it crashed at Idea-Agent before this slice).

## Slice 4 — Safety controls + typed flat operator (F-03, F-06, F-08, F-22, F-23, F-24, F-31)
- Status: done
- estimateCostUsd price table; operator charges every LLM call via brain.addConsumedCost —
  the budget hard-halt is fire-able; applyPolicy extraction (fail-closed: policy error →
  supervisor, double failure → blocked); mitigation cannot change task_id/company_id;
  ToolOutputSchema parsed in executeTool; mitigated_task reuses OperatorTaskSchema;
  hard-halt payload parses through HardHaltSchema.
- Deviation: cost accumulation lives in the operator only (policy + tool calls — the
  recurring spend). Supervisor/CEO/Idea single calls are not charged; charging them would
  have required brain writes in contexts tests don't isolate. Noted in pricing.ts as a
  follow-up if needed.

## Slice 5 — Graph loop + strict CLI (F-01, F-07, F-10, F-19, F-20)
- Status: done
- maxCycles in AgentState (export-let + crashing dynamic import deleted); --max-cycles
  verified working end-to-end in simulated mode; completed/halted tasks skipped and merged
  back by task_id; parseCliArgs strict with VenturePayloadSchema validation; engines >=22.5.

## Slice 6 — Server hygiene (F-15, F-30, F-33)
- Status: done
- Shared parseEventQuery (empty-string params rejected); SSE heartbeat + full cleanup on
  close; 405 for non-GET; JSON content-type on 404; task_count dropped.

## Slice 7 — Dashboard real (F-04, F-12, F-17, F-18, F-27, F-28, F-29, F-40)
- Status: done
- index.html + main.tsx (vite build verified); committed-id EventSource lifecycle with
  URL-encoding and onerror; company-switch resets; derived visibleEvents; scrubber reaches
  the last event; VentureView wired to /companies/:id; duplicate onDoubleClick dropped;
  7 new App-level tests.

## Slice 8 — Housekeeping + upstream record (F-34, F-38, F-39, F-41 + F-35/36/37)
- Status: done
- capability-export deleted (~420 lines); tools/README.md capability index;
  src/__tests__/helpers.ts extraction; initDb reuse in server tests; npm run
  test:cli-agent added; __pycache__ removed; scaffold-owned findings recorded in
  docs/scaffold-issues.md for upstream.
