# PRD: Quality Rework — Full-Codebase Audit Fixes

## Problem Statement

A three-lens audit (correctness, structural quality, simplification) of the entire
codebase found 42 findings (F-01…F-42 in `design.md`). Five capabilities are verifiably
broken: the `--max-cycles` flag crashes on every use, simulated mode crashes at the first
agent, the token-budget hard-halt can never fire, the web dashboard cannot be served, and
`npm run typecheck` fails. Beyond those, the safety controls fail open, tests cover a
clone of the ledger instead of the real one, and ~650 removable lines of duplication and
dead code add drift risk.

## Solution

One structured improvement pass that fixes every repo-owned finding, grouped into the ten
decision classes from `design.md` (D1–D9 implemented here; D10 recorded for upstream).
After this pass: every advertised CLI flag and runtime mode works, safety controls are
fail-closed and fire-able, the dashboard serves and shows real venture data, typecheck and
the full test suite pass, and duplication is collapsed to canonical homes.

## User Stories

1. As an operator of the system, I want `--max-cycles N` to cap the monitor loop instead of crashing, so that I can bound run cost. (F-01)
2. As a developer, I want `AGENT_MODEL=simulated` to complete an end-to-end run with explicit fixture keys, so that I can test the pipeline without API spend — and fixture drift fails loudly instead of silently falling back. (F-02)
3. As an operator, I want every LLM call's estimated cost accumulated into `tokens_consumed_usd`, so that the budget hard-halt actually fires when the ceiling is reached. (F-03)
4. As an operator, I want the policy layer to fail closed — a policy error escalates to the supervisor, and a supervisor error blocks the task — so that no task executes ungated. (F-06)
5. As an operator, I want completed and halted tasks excluded from subsequent monitor cycles, so that work isn't re-done and supervisor halts stick. (F-07)
6. As an operator, I want a supervisor mitigation unable to change `task_id`/`company_id`, so that ledger linkage cannot be corrupted by LLM output. (F-08)
7. As a developer, I want the ledger injectable (`createLedger(dbPath)`) and both ledger and Company Brain anchored to one resolved root with env overrides, so that runs from any CWD write one consistent tree and tests inject temp paths without `process.chdir`. (F-09, F-21)
8. As a developer, I want `npm run typecheck` to pass. (F-05)
9. As a developer, I want `queryFailures` to return typed rows with payload as a field, so that payload keys cannot clobber row metadata. (F-16)
10. As a developer, I want tool output parsed by a `ToolOutputSchema` and the operator's policy block extracted into a flat `applyPolicy` helper, so that the operator reads as its five layers with no stringly coercion. (F-22, F-31)
11. As a developer, I want `mitigated_task` to reuse `OperatorTaskSchema` and the hard-halt event parsed through `HardHaltSchema`, so that schemas have one definition each. (F-23, F-24)
12. As a developer, I want one OpenAI-compatible model class serving both cloud OpenAI and local Ollama, with correct parameters for o-series models. (F-11, F-25)
13. As a developer, I want clear boundary errors from every provider (empty content, missing keys, truncation) instead of cryptic downstream JSON failures, brace repair in exactly one place, CLI timeouts that escalate to SIGKILL, and explicit model ids that bypass the `AGENT_PROVIDER` override. (F-13, F-14, F-26)
14. As a developer, I want model instances memoized per provider+id, so that agents stop constructing a fresh SDK client per call. (F-32)
15. As a dashboard user, I want the web app to serve via vite (entry point exists), show real venture data in the Venture tab, keep companies' events separate when I switch, and let me scrub to the last event. (F-04, F-12, F-17, F-27)
16. As a dashboard user, I want the event stream connection opened once per confirmed company id (encoded, with error handling), and the visible-event window computed rather than mirrored in state. (F-18, F-28, F-29)
17. As a developer, I want `parseArgs` strict with `--venture` validated by `VenturePayloadSchema`, so that bad CLI input fails at the boundary with a clear message. (F-10, F-19)
18. As a maintainer, I want `engines.node` to match the floor actually tested (>=22.5), the superseded `tools/capability-export/` deleted, a `tools/README.md` capability index added, shared test helpers extracted, the stale `test:cli-agent` reference fixed, `__pycache__` removed and ignored, and stale comments corrected. (F-20, F-34, F-38, F-39, F-41, F-42)
19. As a maintainer, I want server route param validation shared, `task_count` derived instead of recomputed, and SSE/HTTP hygiene fixed (abort cleanup, heartbeat, 404 content-type, method check, empty `since` rejected). (F-15, F-30, F-33)
20. As a scaffold maintainer, I want the scaffold-owned findings (F-35, F-36, F-37) recorded in `docs/scaffold-issues.md` with file/line references, so they can be fixed upstream and flow back via sync.

## Implementation Decisions

- **Model contract** (D1): `Model.generate` returns `GenerateResult { text: string; usage?: { inputTokens: number; outputTokens: number } }`. All six providers migrate in one step; callers destructure `text`. Pricing lives in one table in the LLM layer (`estimateCostUsd(provider, id, usage|text)`); only the operator and the other agents' call paths accumulate cost into the Company Brain's `tokens_consumed_usd` after each call. Character-based fallback when usage is absent (chars/4 ≈ tokens). The price table is documented as approximate.
- **Fail-closed policy** (D1): `policyCheck` error → supervisor escalation; supervisor error → task `blocked` (existing `failed` path for supervisor errors during normal escalation is preserved). No path proceeds to tool execution without a passing gate.
- **Graph loop** (D1): operators receive only tasks whose status is not `completed`/`halted`; returned tasks merge back by `task_id`. `maxCycles` is an optional field of `runGraph`'s initial state, replacing the `export let` and dynamic import.
- **Mitigation merge** (D1): spread excludes `task_id` and `company_id` (take them from the original task).
- **Fixture keys** (D2): `LlmRequestOptions.fixtureKey?: string`; agents pass constants (`idea:generate`, `ceo:init`, `<role>:policy`, `<role>:tool`, `supervisor:policy`, `monitor:diagnose`). `SimulatedModel` throws on missing key or unknown key. Keyword tables and `resolveKey` deleted. A test asserts the set of keys used by agents equals the fixture map keys.
- **Ledger** (D3): `createLedger(dbPath)` returns `{ record, queryEvents, tailEvents, queryFailures, close }` over one `DatabaseSync`. A lazy default instance preserves `record(...)` call sites. `*FromDb` functions and dead singleton wrappers removed; server takes a ledger handle. `FailureRow` typed with `payload` as a field. `tailEvents` clears its timer on abort. TS2345 fixed by typing params as `SQLInputValue`.
- **Path anchoring** (D3): one `resolveCompaniesDir()` — env override `COMPANIES_DIR`, else `<repo-root>/companies` resolved from the module location. Ledger DB path defaults inside it. companyBrain and ledger share it; tests set `COMPANIES_DIR` instead of `process.chdir`.
- **Operator** (D4): `ToolOutputSchema { deliverable: string, artifacts: string[], confidence: number, next_actions: string[] }` in schemas.ts, parsed in `executeTool`. L2 extracted to `applyPolicy(task, ctx) → { task, verdict: 'proceed' | OperatorTask }` (verdict returns the terminal task on block/halt/fail). Small cleanups per F-31.
- **Schemas** (D5): `mitigated_task: OperatorTaskSchema.optional()`; supervisor hard-halt payload built via `HardHaltSchema.parse`.
- **Providers** (D6): `OpenAIModel` gains optional `{ baseURL, apiKey, provider }`; `local.ts` deleted; o-series ids (o1/o3/o4 prefix) use `max_completion_tokens` and omit `temperature`. Boundary errors: throw on empty/missing completion content, missing API key (constructor), Anthropic non-text or truncated (`stop_reason === 'max_tokens'`) responses. Brace repair only in `parseModelJson` (Anthropic returns raw text; parseModelJson handles the missing-brace case — but no longer mangles prose: only prepend `{` when the text plausibly is brace-stripped JSON, i.e. ends with `}`). Explicit `modelId` argument disables the `AGENT_PROVIDER` env override (env applies only to env-derived ids). CLI model: SIGTERM then SIGKILL after 5s grace. `createModel` memoizes by `provider:id`.
- **Web** (D7): add `web/index.html` + `web/src/main.tsx`. Venture tab fetches `/companies/:id` and renders `VentureView` (loading/error states minimal). `visibleEvents` computed from `playhead` + `allEvents`. Company switch resets events/selection/playhead; company input commits on Enter/blur (no EventSource per keystroke); URL-encode the id; `onerror` closes and surfaces a simple status. Scrubber max equals event count (0..total semantics, last event reachable). Duplicate `onDoubleClick` dropped.
- **CLI** (D8): `parseArgs` `strict: true`; `--venture` parsed in try/catch + `VenturePayloadSchema.parse`; `--max-cycles` validated numeric with a clear error; main.ts summary uses the resolved companies dir.
- **Server** (D9-adjacent, F-15/F-30/F-33): shared `parseEventQuery` in events route (rejects empty/NaN params); SSE heartbeat comment every 30s and cleanup on close; 404 sets Content-Type; non-GET → 405; `task_count` removed from companies payload (client derives).
- **Housekeeping** (D9): delete `tools/capability-export/`; add `tools/README.md` listing hoist-skill; `src/__tests__/helpers.ts` exports `makeTask`, `stubModel`, http `get`; server tests reuse `initDb`; fix smoke-test comment; remove `__pycache__`, gitignore it; engines `>=22.5`; fix ledger header comment.
- **Upstream record** (D10): append F-35/F-36/F-37 details to `docs/scaffold-issues.md`. No scaffold-owned file is edited.

## Testing Decisions

- Prior art: vitest, `vi.mock` of `../llm/index.js` and `../ledger.js`, temp-dir isolation; 113 existing tests must keep passing (adjusted where contracts change, e.g. `generate` return type).
- Risky fixes that REQUIRE new tests: budget accumulation + hard-halt firing (D1), fail-closed policy paths (D1), graph skip-completed/halted + maxCycles param (D1/D8), fixture-key resolution incl. unknown-key throw and key-coverage assertion (D2), `createLedger` real-module coverage replacing the inline clone (D3), `ToolOutputSchema` rejection of malformed tool output (D4), provider boundary errors and o-series params (D6, unit-level with mocked SDK), App-level dashboard tests for company switch/visibleEvents/scrubber bounds (D7), strict CLI parsing (D8, function-level if main is refactored to expose arg parsing).
- Pure deletions/mechanical moves (capability-export, helpers extraction, comment fixes) need no new tests beyond the suite staying green.
- `npm run typecheck` and `npm test` (root + web) green is the exit criterion for every slice.

## Out of Scope

- Edits to scaffold-owned files (`bin/`, `scripts/`, `tools/hoist-skill/`, skill wrappers) — recorded in `docs/scaffold-issues.md` instead.
- New product features, agent-architecture redesign, accurate billing/metering (cost is an estimate), web features beyond wiring what exists.
- F-07 broader re-run semantics (`pending`/`failed`/`blocked` retry behavior stays as-is; only `completed`/`halted` are excluded).

## Further Notes

- The price table will need occasional manual refresh; it is a safety estimate, not billing.
- If upstream scaffold later ships the resolver-parser dedupe, `docs/scaffold-issues.md` entries should be checked off via `/sync-scaffold`.
- `engines.node >=22.5` chosen because the suite runs on Node 22 today; `.nvmrc` stays at 26 as the recommended dev version.
