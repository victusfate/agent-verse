# Design: Quality Rework — Full-Codebase Audit

Three audit lenses were run over the entire codebase (~47 source files, ~4,300 lines):
correctness review at max effort, structural quality review, and simplification review.
This design consolidates their findings and decides how each class will be fixed.

## Canonical Vocabulary

| Term | Definition |
|---|---|
| Finding | A single audited issue, identified by `F-NN`, with source lens and severity. |
| Audit lens | The review skill that produced a finding: `[review]` (correctness), `[quality]` (structure), `[simplify]` (reduction). |
| Scaffold-owned file | A file listed in `.github/scaffold-files.txt`, synced from the upstream scaffold repo. Local edits risk conflict on next sync; the canonical fix belongs upstream and is recorded in `docs/scaffold-issues.md`. |
| Repo-owned file | Any file not in the scaffold manifest. Fixed directly in this repo. |
| Safety controls | The runtime guardrails the agent system advertises: token-budget hard-halt, policy layer, supervisor verdicts. |
| Fail-open / fail-closed | Whether a guard that errors lets the action proceed (open) or blocks it (closed). |
| Fixture key | An explicit identifier an agent passes to `SimulatedModel` to select a canned response, replacing prompt-keyword sniffing. |
| Ledger handle | A ledger instance created by `createLedger(dbPath)`, closing over one `DatabaseSync` — replaces the module-level singleton. |

## Findings

Severity: **high** = verifiably broken behavior or untested safety control; **medium** = latent bug or structural debt with drift risk; **low** = hygiene. `[uncertain]` per the max-effort review contract.

### Broken end-to-end (verified by the correctness audit)

| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-01 | [review][quality][simplify] | src/main.ts:64, src/graph.ts:16 | `--max-cycles` always crashes: assigning to an ESM module-namespace export throws. Root cause is `export let MAX_MONITOR_CYCLES` mutable-export-as-config plus a redundant dynamic re-import. | high |
| F-02 | [review][quality] | src/llm/simulated.ts:14, src/simulation/fixtures.ts | Fixture keyword routing drifted from real prompts (`"Initialize the company"` vs ceo.ts `"Initialise company"`; idea.ts never says `"Generate a venture"`; policy prompts name no role). `AGENT_MODEL=simulated` crashes at Idea-Agent; unit tests pass only by hand-feeding magic strings. | high |
| F-03 | [review] | src/agents/operator.ts:141, src/agents/supervisor.ts:35 | `tokens_consumed_usd` is read everywhere but never written by production code — remaining budget never decreases, so the budget hard-halt and policy budget context can never fire. The advertised token-budget ceiling is inert. | high |
| F-04 | [review] | web/ | No entry point exists (no `index.html`, no `main.tsx`) — vite cannot serve or build the dashboard; App.tsx is unreachable. | high |
| F-05 | [review] | src/ledger.ts:80, src/__tests__/ledger.test.ts:59 | `npm run typecheck` fails (TS2345 `unknown` → `SQLInputValue`). The repo does not pass its own typecheck. | high |

### Safety-control gaps

| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-06 | [review] | src/agents/operator.ts:180 | Policy layer fails open: if `policyCheck` throws (LLM error, bad JSON), the operator logs and proceeds to tool execution ungated. In simulated mode this is the default path (see F-02). | medium |
| F-07 | [review] | src/graph.ts:52 | Every monitor cycle re-runs ALL tasks including completed/halted/blocked ones — duplicate LLM spend, duplicate ledger entries, and a supervisor `halted` verdict is retried next cycle. `[uncertain]` whether re-running non-halted tasks is intended. | medium |
| F-08 | [review] | src/agents/operator.ts:170 | `{ ...task, ...decision.mitigated_task }` lets the LLM-authored mitigation overwrite `task_id`/`company_id`, corrupting ledger linkage and brain/task-log paths. | medium |

### Runtime correctness

| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-09 | [review][quality] | src/ledger.ts:15, src/companyBrain.ts:9 | Path anchoring is inconsistent: ledger.db anchored to the source tree (`__dirname/../companies`), Company Brain to CWD. Run from anywhere but repo root and the two land in different trees; the server then can't see what main.ts wrote. Both are hard-coded singletons, forcing `process.chdir` choreography in four test files. | medium |
| F-10 | [review] | src/main.ts:76 | `--venture` is `JSON.parse`d with no try/catch and cast without `VenturePayloadSchema.parse` — malformed input fails deep inside ceoAgent with confusing errors. | medium |
| F-11 | [review] | src/llm/openai.ts:21 | Uses `max_tokens` on chat.completions while `detectProvider` routes o1/o3/o4 reasoning models here — those reject `max_tokens` (need `max_completion_tokens`) and non-default temperature. `[uncertain]` | medium |
| F-12 | [review] | web/src/App.tsx:19 | Switching `companyId` never resets `allEvents`/`visibleEvents`/`selected` — previous company's events stay mixed into the new feed and scrubber. | medium |
| F-13 | [review] | src/llm/* | Boundary gaps: `anthropic.ts:36` indexes `content[0]` unchecked and ignores `stop_reason === 'max_tokens'`; openai/local coerce null content to `''`; google.ts defaults a missing `GEMINI_API_KEY` to `''`; `parseModelJson` prepends `{` to any non-JSON output, mangling the real error; `AGENT_PROVIDER` overrides provider detection even for explicit model ids. | low |
| F-14 | [review] | src/llm/cli.ts:43 | Timeout sends SIGTERM with no SIGKILL escalation (ignoring child leaks, keeps event loop alive); stderr discarded on success. | low |
| F-15 | [review] | src/ledger.ts:92, src/server/* | Stream/HTTP hygiene: tail-poll abort leaves a live 500ms timer and `res` is never ended after abort; SSE has no heartbeat; `?since=` empty string silently becomes 0; 404 lacks Content-Type; HTTP method ignored. | low |
| F-16 | [review][quality] | src/ledger.ts:134 | `queryFailures` spreads payload after row metadata — payload keys named `ts`/`event_type` clobber real values; return type is `Record<string, unknown>[]` instead of a typed row. | low |
| F-17 | [review] | web/src/components/Scrubber.tsx:35 | Off-by-one: slider max is `total-1` but playing playhead is `total` — the last event is unreachable by scrubbing. | low |
| F-18 | [review] | web/src/App.tsx:22 | SSE URL built without `encodeURIComponent`; a new EventSource opens on every keystroke; no `onerror` handling. | low |
| F-19 | [review] | src/main.ts:54 | `parseArgs` with `strict: false` forces four `as string` casts; `--seed` without a value parses to boolean `true` and is sent to the LLM as the prompt. | low |
| F-20 | [review] | package.json:7 | `engines.node >= 26` while the project is developed and tested on Node 22 (and the stale ledger comment references `--experimental-sqlite`). `[uncertain]` which floor is intended. | low |

### Structure and duplication (repo-owned)

| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-21 | [quality][simplify] | src/ledger.ts | Module singleton with hard-coded DB_PATH causes: dead exported wrappers `queryEvents`/`tailEvents` (nothing calls them); a dual `*FromDb` API; and `ledger.test.ts:18-84` reimplementing the entire ledger (~70 lines of cloned DDL+SQL) so production `record`/`queryFailures` SQL has zero test coverage. | high |
| F-22 | [quality] | src/agents/operator.ts:69 | `executeTool` returns `Record<string, unknown>`; every consumer re-coerces (`String(...)`, `Number(...)`, `Array.isArray` casts). EXECUTE_SCHEMA documents the shape but no zod schema enforces it. The L2 block (139-185) nests escalation/verdict/override four levels deep inside one try whose catch is the F-06 fail-open. | high |
| F-23 | [quality][simplify] | src/schemas.ts:10 | `SupervisorDecisionSchema.mitigated_task` re-declares all OperatorTask fields inline — will drift when task fields change. | medium |
| F-24 | [quality][simplify] | src/schemas.ts:25 | `HardHaltSchema` is used only by tests; the real hard-halt event in supervisor.ts:44 records a hand-built object that is never parsed against it. | low |
| F-25 | [quality][simplify] | src/llm/local.ts | `LocalModel` is byte-for-byte `OpenAIModel` except the client constructor — line-identical `generate()` bodies. | medium |
| F-26 | [quality][simplify] | src/llm/index.ts:128, src/llm/anthropic.ts:40 | Brace repair for the Anthropic prefill lives in two layers — both prepend `{` for the same failure mode. | low |
| F-27 | [quality][simplify][review] | web/src/components/VentureView.tsx | Dead component: implemented and component-tested but never imported — the Venture tab renders a hard-coded placeholder, and the server's `/companies/:id` endpoint has no consumer. | medium |
| F-28 | [quality][simplify] | web/src/App.tsx:13 | `visibleEvents` is derived state held in `useState` and synced via an effect plus manual slicing in `seek()` — classic desync hazard; should be computed. | medium |
| F-29 | [simplify] | web/src/components/LiveFeed.tsx:17 | `onDoubleClick` duplicates the identical `onClick` on the same row. | low |
| F-30 | [quality][simplify] | src/server/routes/events.ts:6 | Both handlers repeat URL parse, company_id check, and numeric-param validation with identical 400 responses. | low |
| F-31 | [simplify] | src/agents/* | Small cleanups: redundant `initLedger()` call in ceo.ts (record() lazy-inits); `budgetCtx` re-reads values computed at operator.ts:141; supervisor.ts:63 recomputes `remaining`; inline `import('../schemas.js').SupervisorDecision` type; `ROLE_CONTEXT` typed `Record<string, string>` instead of keyed by the role enum. | low |
| F-32 | [simplify] | src/llm/index.ts:74 | `createModel` constructs a fresh SDK client per call (operator calls it twice per task per cycle); `stripProviderPrefix` duplicates the prefix knowledge in `detectProvider`. | low |
| F-33 | [simplify] | src/server/routes/companies.ts:31 | Reads and JSON-parses the whole task_log.jsonl to return it plus a `task_count` derivable from `tasks.length`. | low |

### Scaffold tooling

| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-34 | [simplify][review] | tools/capability-export/ | Entire tool (~420 lines incl. test/README/tool.yaml) is an older feature-subset copy of `tools/hoist-skill` with a byte-identical tool.yaml description. Nothing references it; hoist-skill (the registered skill) is a strict superset. **Repo-owned** (not in scaffold manifest) — deletable here. | high |
| F-35 | [quality][simplify][review] | scripts/*.mjs, tools/*/run | `splitRow`/`parseResolver` copy-pasted 4× (check-resolvable, update-readme-skills, both tools' run). The two `scripts/` copies and hoist-skill are **scaffold-owned** — dedupe belongs upstream. hoist-skill's standalone copy is deliberate (fetched into consumer repos). | medium |
| F-36 | [review] | tools/, bin/ | §6 checklist violations, all in **scaffold-owned** files: tool `run`/`test` not executable (+x); no capability index (`tools/README.md`); unknown flags silently ignored; bin scripts don't resolve the repo root (break from subdirs); bootstrap clobbers an existing sync script; `"${files[@]}"` under `set -u` breaks on bash 3.x with an empty manifest; no isolated tests for bin entrypoints. | medium |
| F-37 | [simplify] | tools/hoist-skill/run, scripts/update-readme-skills.mjs | `registry.find` repeated inside four loops (→ Map); README.md read from disk twice. **Scaffold-owned.** | low |

### Tests and housekeeping

| ID | Source | File | Finding | Severity |
|---|---|---|---|---|
| F-38 | [quality][simplify] | src/__tests__/*, web/src/__tests__/* | `makeTask` copy-pasted into three test files, the model stub into two, the mkdtemp+chdir block into four, the `get()` http helper into two, and hand-written events DDL duplicating `initDb`. | medium |
| F-39 | [review] | src/__tests__/cli-agent.smoke.test.ts:5 | Documents `npm run test:cli-agent`, which doesn't exist in package.json. | low |
| F-40 | [review] | web/src/App.tsx | The only stateful dashboard logic (EventSource lifecycle, playhead) has no tests; only leaf components are covered. | low |
| F-41 | [simplify] | src/agents/__pycache__/ | Orphaned Python bytecode from a pre-TypeScript iteration (untracked); `__pycache__/` not in .gitignore. | low |
| F-42 | [review] | src/ledger.ts:7 | Stale header comment requiring `NODE_OPTIONS='--experimental-sqlite'`. | low |

## Decisions

Grouped by fix class, not finding-by-finding. Each class is a candidate vertical slice for the plan.

**D1 — Repair the safety controls (F-03, F-06, F-07, F-08).**
Budget accounting: providers return token usage where the SDK exposes it; the operator
accumulates an estimated USD cost into `tokens_consumed_usd` after every LLM call (a small
per-provider price table; unknown providers estimate from characters). Policy layer becomes
fail-closed: a `policyCheck` error escalates to the supervisor instead of proceeding; if the
supervisor also fails, the task is marked `blocked`, never silently executed. The graph loop
skips tasks whose status is `completed` or `halted`. The mitigation spread excludes identity
fields (`task_id`, `company_id`).

**D2 — Explicit fixture keys for simulated mode (F-02).**
Add `fixtureKey` to `LlmRequestOptions`; each agent call site passes its constant key
(`idea:tool`, `ceo:tool`, `<role>:policy`, …). `SimulatedModel` does a direct map lookup and
throws on unknown keys — no keyword sniffing, drift becomes a hard error. Delete
`resolveKey`/keyword tables. Add a test asserting every key passed in production code exists
in the fixture map.

**D3 — Injectable ledger and unified path anchoring (F-05, F-09, F-16, F-21, F-42).**
`createLedger(dbPath)` returns `{ record, queryEvents, tailEvents, queryFailures }` closed
over one `DatabaseSync`; a lazy default instance keeps agent call sites unchanged. Both the
ledger and `COMPANIES_DIR` anchor to a single repo-root resolution with an env override
(`COMPANIES_DIR`), removing the `__dirname`-vs-CWD split and the `process.chdir` test
choreography. Delete the dead `queryEvents`/`tailEvents` singleton wrappers and the dual
`*FromDb` naming. Fix the TS2345 typecheck error. `queryFailures` returns a typed `FailureRow`
with payload as a field (no spread-clobbering). `ledger.test.ts` deletes its ~70-line clone
and tests the real module.

**D4 — Typed tool output and a flat operator (F-22, F-31).**
Add `ToolOutputSchema` to schemas.ts and parse in `executeTool`; all stringly indexing and
`Number`/`String` coercion disappears. Extract the L2 policy/supervisor block into an
`applyPolicy(task, ctx)` helper returning a typed verdict, so `run()` reads as five flat
layer calls (this is also where D1's fail-closed behavior lands). Apply the small agent
cleanups (redundant initLedger, recomputed budget values, inline import type, ROLE_CONTEXT
keying).

**D5 — Schema dedup (F-23, F-24).**
`mitigated_task: OperatorTaskSchema.optional()` replaces the inline re-declaration. The
hard-halt event payload in supervisor.ts is parsed through `HardHaltSchema` at the call
site, making the schema real instead of test-only.

**D6 — LLM provider hardening and dedupe (F-11, F-13, F-14, F-25, F-26, F-32).**
Merge `LocalModel` into a configurable `OpenAIModel` (optional baseURL/apiKey/provider).
Use `max_completion_tokens` for o-series models. At each provider boundary: throw a clear
error on empty/missing completion content and missing API keys; check Anthropic
`stop_reason` for truncation. Brace repair lives only in `parseModelJson` (anthropic.ts
returns raw text). Explicit model ids ignore the `AGENT_PROVIDER` override. CLI timeout
escalates SIGTERM → SIGKILL. Memoize the model instance per resolved provider+id.

**D7 — Make the dashboard real (F-04, F-12, F-17, F-18, F-27, F-28, F-29).**
Add `web/index.html` + `web/src/main.tsx` so vite can serve and build. Wire `VentureView`
into the Venture tab (consuming the existing `/companies/:id` endpoint). Compute
`visibleEvents` instead of mirroring it in state. Reset event state on company switch;
debounce/confirm the company input so EventSource isn't reopened per keystroke; encode the
URL; handle `onerror`. Fix the scrubber off-by-one. Drop the duplicate `onDoubleClick`.
Add App-level tests for the EventSource/playhead logic (F-40).

**D8 — CLI and config hygiene (F-01, F-10, F-19, F-20).**
`maxCycles` becomes an optional field of `runGraph`'s initial state; delete `export let`
and the dynamic re-import. `parseArgs` goes `strict: true` with typed values; `--venture`
is parsed inside try/catch and validated with `VenturePayloadSchema`. Set `engines.node`
to the floor actually tested (>=22.5, matching `node:sqlite` availability) while keeping
`.nvmrc` at 26 — or confirm 26 intentionally; default is the former.

**D9 — Repo-owned tooling and tests (F-34, F-38, F-39, F-41).**
Delete `tools/capability-export/` entirely. Extract `src/__tests__/helpers.ts` (makeTask,
stubModel, withTempDir, http get) and reuse `initDb` in server tests. Fix or remove the
stale `test:cli-agent` reference. Delete `src/agents/__pycache__/` and gitignore it.

**D10 — Scaffold-owned findings go upstream (F-35, F-36, F-37).**
Do not patch scaffold-owned files here (next sync would conflict or revert). Append these
findings to `docs/scaffold-issues.md` with file/line references so they can be fixed in the
scaffold repo and flow back via sync. Exception: adding a **new** repo-owned
`tools/README.md` capability index is allowed and closes the registration gap locally.

## Scope

**In:** everything in D1–D9 (repo-owned: src/, web/, tests, package.json, tools/capability-export deletion, new tools/README.md); recording D10 upstream issues in docs/scaffold-issues.md.

**Out:** edits to scaffold-owned files (bin/, scripts/, tools/hoist-skill/, skill wrappers); new product features or agent-architecture redesign; web features beyond wiring what already exists; performance work beyond the listed findings.

## Edge Cases

- **Scaffold sync:** any file in `.github/scaffold-files.txt` may be overwritten by `bin/sync-from-scaffold.sh`. The design deliberately routes those fixes upstream (D10). `tools/README.md` and `tools/capability-export/` are not in the manifest — safe to add/delete.
- **hoist-skill's parser copy is intentional** — the tool is fetched standalone into consumer repos and cannot import a shared lib from this repo. Dedupe applies only to the two `scripts/` copies (upstream).
- **Ledger lazy default must survive D3** — agents call `record()` without a handle; the default instance keeps that contract while tests inject temp paths.
- **F-07 re-run semantics are [uncertain]:** re-running `pending`/`in_progress` tasks across cycles may be intended (monitor retries). The fix only excludes `completed` and `halted`; anything broader needs product input.
- **Budget accounting (D1) is an estimate, not metering** — provider usage fields differ; the control's job is to make the hard-halt *fire-able*, not to bill accurately. Document the price table as approximate.
- **Simulated fixture keys (D2) change `LlmRequestOptions`** — all five agents and the fixture map must move in the same slice or simulated mode breaks worse mid-refactor.
- **vitest `vi.mock` boilerplate is per-file by design** — not extractable into helpers.ts; don't try.
- **Web entry point (D7) must not break component tests** — they currently mount components directly; adding main.tsx is additive.
