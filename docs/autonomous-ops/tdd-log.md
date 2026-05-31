# TDD Log: Autonomous Ops

## Slice 1 — SupervisorDecision, HardHalt, halted status schemas
- Status: done
- Tests: 9 passing in `supervisor.schemas.test.ts`
- Notes: Added SupervisorDecision + HardHalt schemas; extended OperatorTask.status with 'halted'; added 'cli'/'simulated' to LlmProviderType

## Slice 2 — Supervisor agent mitigate/pass/halt branches
- Status: done
- Tests: 3 passing in `supervisor.test.ts`
- Notes: inject task_id from task param; LLM returns action/reason/estimated_cost_usd

## Slice 3 — Supervisor budget hard-halt (pre-LLM check)
- Status: done
- Tests: 5 passing in `supervisor.test.ts`
- Notes: MIN_TASK_BUDGET_USD = $0.05 floor; budget check fires before LLM call; floating point caution in test values

## Slice 4 — Operator routes escalation to supervisor
- Status: done
- Tests: 7 passing in `operator.test.ts`
- Notes: operator reads budget ctx from companyBrain; supervisor mock injected via vi.mock

## Slice 5 — CliModel subprocess provider
- Status: done
- Tests: 8 passing in `llm.cliModel.test.ts`
- Notes: echo/printf don't read stdin — use cat for round-trip tests; sleep 10 as single command string for timeout test

## Slice 6 — SimulatedModel fixture provider
- Status: done
- Tests: 7 passing in `llm.simulatedModel.test.ts`
- Notes: keyword matching on system instruction text; fallback with stderr warning; 'simulated' provider ID

## Slice 7 — Ledger queryEvents + tailEvents
- Status: done
- Tests: 12 passing in `ledger.test.ts` (6 new)
- Notes: inline buildLedger helper validates SQL logic against real SQLite; functions also added to src/ledger.ts

## Slice 8 — HTTP server with SSE + REST events endpoints
- Status: done
- Tests: 5 passing in `server.events.test.ts`
- Notes: npm peer conflict prevented Express install; using node:http built-in (consistent with node:sqlite pattern); full SSE + range query working

## Slice 9 — Company REST endpoints
- Status: pending

## Slice 10 — React frontend scaffold + Live Feed
- Status: pending
- Notes: cannot browser-verify in remote execution environment; will scaffold and structure-test

## Slice 11 — Timeline scrubber + drill-down
- Status: pending

## Slice 12 — Venture View + Ledger Explorer panels
- Status: pending

## Slice 13 — CLI smoke test
- Status: pending
