# Plan: Quality Rework — Vertical Slices

Each slice is independently shippable: schema/data → logic → (UI) → tests, ending with
`npm run typecheck` + `npm test` (and `npm test` in `web/` when touched) green.
Slice order minimizes churn: foundations (paths/ledger, model contract) before the
consumers that build on them.

## Slice 1 — Injectable ledger + unified path anchoring (D3: F-05, F-09, F-16, F-21, F-42)

**RED:** New `ledger.test.ts` against the real module: `createLedger(tmpPath)` →
`record`/`queryEvents`/`queryFailures`/`tailEvents` behavior, including payload-key
non-clobbering (`FailureRow.payload` is a field) and tail abort clears its timer.
`companyBrain.test.ts` switches from `process.chdir` to `COMPANIES_DIR` env.

**GREEN:** `resolveCompaniesDir()` (env `COMPANIES_DIR` else `<repo-root>/companies`)
shared by ledger and companyBrain. `createLedger(dbPath)` returning
`{ record, queryEvents, tailEvents, queryFailures, close }`; lazy default instance keeps
`record(...)` call sites working. Delete `*FromDb` duals and dead singleton wrappers;
server routes take a ledger handle. Type SQL params as `SQLInputValue` (fixes TS2345).
Fix stale header comment. Delete the test's inline ledger clone.

## Slice 2 — Model contract + provider hardening/dedupe (D6: F-11, F-13, F-14, F-25, F-26, F-32)

**RED:** Provider unit tests (mocked SDKs): `generate` returns
`{ text, usage? }`; o-series uses `max_completion_tokens`, no temperature; empty
content / missing API key / Anthropic truncation throw clear errors; `parseModelJson`
no longer mangles prose; explicit model id bypasses `AGENT_PROVIDER`; memoized
`createModel` returns the same instance for the same `provider:id`; CLI timeout
escalates SIGTERM→SIGKILL.

**GREEN:** `GenerateResult { text, usage? }` across all six providers; merge
`LocalModel` into configurable `OpenAIModel` (delete `local.ts`); brace repair only in
`parseModelJson` (only when text ends with `}`); anthropic returns raw text; constructor
key checks; memoization map; update all agent call sites to `.text`.

## Slice 3 — Explicit fixture keys for simulated mode (D2: F-02)

**RED:** `SimulatedModel` resolves by `options.fixtureKey`, throws on missing/unknown
key; key-coverage test asserting agent-used keys == fixture map keys; end-to-end
simulated `runGraph` completes.

**GREEN:** `LlmRequestOptions.fixtureKey`; agents pass constants (`idea:generate`,
`ceo:init`, `<role>:policy`, `<role>:tool`, `supervisor:policy`, `monitor:diagnose`);
delete `resolveKey` + keyword tables.

## Slice 4 — Safety controls + typed flat operator (D1, D4, D5: F-03, F-06, F-08, F-22, F-23, F-24, F-31)

**RED:** Budget accumulates into `tokens_consumed_usd` after LLM calls and the
supervisor hard-halt fires when exhausted; policy error escalates to supervisor
(fail-closed) and supervisor error → `blocked`; mitigation cannot change
`task_id`/`company_id`; malformed tool output rejected by `ToolOutputSchema`; hard-halt
payload parses through `HardHaltSchema`.

**GREEN:** Price table + `estimateCostUsd` in LLM layer; operator/supervisor/idea/ceo
accumulate cost via brain context. `applyPolicy(task, ctx)` extraction; `ToolOutputSchema`
parse in `executeTool`; `mitigated_task: OperatorTaskSchema.optional()`; F-31 cleanups
(drop redundant `initLedger` import in ceo, reuse computed budget values, top-level
`SupervisorDecision` import, `ROLE_CONTEXT` keyed by role enum).

## Slice 5 — Graph loop + strict CLI (D1, D8: F-01, F-07, F-10, F-19, F-20)

**RED:** `runGraph({ maxCycles })` caps cycles; completed/halted tasks not re-run
(merge-back by `task_id`); strict arg parsing rejects `--seed` without value; bad
`--venture` JSON / shape fails with clear boundary error.

**GREEN:** `maxCycles` in `AgentState` (delete `export let` + dynamic import);
graph filters and merges tasks; `parseArgs strict: true`; venture try/catch +
`VenturePayloadSchema.parse`; `--max-cycles` numeric validation; engines `>=22.5`.

## Slice 6 — Server hygiene (F-15, F-30, F-33)

**RED:** Shared query parsing rejects missing/empty/NaN params on both endpoints;
404 has Content-Type; non-GET → 405; SSE cleans up on abort (res ended); `task_count`
gone from companies payload.

**GREEN:** `parseEventQuery` helper; method check + 404/405 headers in router;
heartbeat comment every 30s; abort listener ends response; drop `task_count`.

## Slice 7 — Dashboard real (D7: F-04, F-12, F-17, F-18, F-27, F-28, F-29, F-40)

**RED:** App tests: company id commits on Enter/blur (one EventSource, encoded URL);
switching company resets events/selection/playhead; `visibleEvents` derived (pause →
slice, play → all); scrubber reaches the last event; Venture tab renders fetched
`VentureView` data.

**GREEN:** `web/index.html` + `web/src/main.tsx`; committed-id state; computed
`visibleEvents`; reset-on-switch; `es.onerror` handling; scrubber 0..total semantics;
remove duplicate `onDoubleClick`; wire VentureView to `/companies/:id`.

## Slice 8 — Housekeeping + upstream record (D9, D10: F-34, F-38, F-39, F-41 + F-35/36/37)

**RED (where applicable):** suite green after extraction — `src/__tests__/helpers.ts`
(`makeTask`, `stubModel`, http `get`), server tests reuse `initDb`.

**GREEN:** Delete `tools/capability-export/`; add `tools/README.md` capability index;
fix smoke-test comment (or add the npm script); delete `src/agents/__pycache__/`,
gitignore `__pycache__/`; append F-35/F-36/F-37 to `docs/scaffold-issues.md`.

## Exit criteria (every slice)

- `npm run typecheck` passes
- `npm test` passes (root; plus `web/` for slice 7)
- Commits: `test(<slug>): slice N red — …` / `feat(<slug>): slice N green — …` / optional `refactor(<slug>): slice N — …`
