# TDD Log: claude-code-runtime

## Slice 1 — SdkModel happy path
- Status: done
- Notes: provider `'sdk'` registered; `generate()` maps system/prompt/session
  onto `query()` options and returns text, usage, `costUsd`. Option-mapping
  assertions were added after the tracer (implementation slightly ahead of
  tests on the mapping details).

## Slice 2 — SdkModel error mapping
- Status: done
- Notes: `SdkSessionError` carries subtype + actual cost; budget vs turns
  distinguishable by callers.

## Slice 3 — Runtime resolution
- Status: done
- Notes: `resolveRuntime` precedence flag > AGENT_RUNTIME > auto-fallback >
  api; `assertSdkModel` rejects non-Claude ids. PATH probe injectable.

## Slice 4 — CLI and startup wiring
- Status: done
- Notes: `--runtime` validated at the boundary; `main.ts` routes sdk runs via
  `AGENT_PROVIDER=sdk`, skips API-key check, errors fast on missing binary.

## Slice 5 — Tool gate
- Status: done
- Notes: full gate implemented at the tracer (read-only allow, path-scoped
  Write/Edit, risk-tier escalation, fail closed, telemetry); remaining five
  behaviors locked by tests immediately after — they passed on first run.

## Slice 6 — Operator integration
- Status: done
- Notes: sdk runtime skips the prompt policy (delegated-to-gate telemetry
  recorded), session context passed to the tool layer, actual cost charged
  (including failed sessions), `error_max_budget_usd` → blocked, others →
  failed.

## Slice 7 — Idea/CEO/Monitor contexts + smoke
- Status: done
- Notes: `readMostlySession` helper; idea/monitor read-only, ceo gets Write
  at the companies root; opt-in smoke test gated on `SDK_AGENT_SMOKE=1`
  exercises a real tool-enabled turn writing a file.

## Suite
- 191 tests passing, 2 opt-in smoke tests skipped (CLI + SDK).
