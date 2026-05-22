# PRD — TypeScript Conversion (`ts-conversion`)

## Problem Statement

The agent-verse corporate AI ecosystem was implemented in Python using LangGraph,
LiteLLM, and Pydantic. Python is a workable foundation, but the project's target
harness (Claude Code, Cursor, Gemini CLI) and the existing architecture plan both
point to TypeScript as the primary language. The Python codebase has no tests,
making it fragile to extend. Developers contributing to the ecosystem need a
single-language implementation with a stable, typed contract between modules and
a test suite that verifies behaviour without making live LLM calls.

## Solution

Replace the Python implementation with a TypeScript implementation on Node 22.
The codebase is structured as a single package with clearly separated modules:
LLM adapters, Zod schemas, a ledger, a company-brain file store, four agents,
a state graph, and a CLI entry point. A unified `Model` interface abstracts all
LLM providers behind a single `generate()` call. Vitest tests verify each module
against a mocked `Model` and a temporary filesystem/DB, so the full suite runs
offline with no API keys.

## User Stories

1. As a developer, I can run `npm start` with an `ANTHROPIC_API_KEY` set and
   watch the full four-agent loop execute and write output to `companies/`.
2. As a developer, I can swap providers by setting `AGENT_MODEL=gpt-4o-mini`
   without changing any source code.
3. As a developer, I can pass `--model gemini-2.5-flash --provider google` on
   the CLI and the system selects the correct adapter automatically.
4. As a developer, I can pass `--model llama3.2 --provider local` to target a
   local Ollama daemon with no API key required.
5. As a developer, I can pass `--seed "invoice reconciliation API"` to guide the
   Idea-Agent without writing code.
6. As a developer, I can pass `--venture '{...}'` to skip the Idea-Agent and
   supply a pre-formed venture payload directly.
7. As a developer, I can run `pnpm test` and all tests pass without any API key
   or network access, using a mocked `Model` and a temp directory.
8. As a developer, I can run `pnpm typecheck` and get zero TypeScript errors.
9. As a developer adding a new provider, I implement the `Model` interface in a
   new file under `src/llm/`, add a case to `createModel()`, and the rest of the
   system works without modification.
10. As a developer, when `jsonMode: true` is passed, each provider adapter coerces
    the response into a raw JSON string using its native mechanism (prefill,
    `response_format`, `responseMimeType`, or `format`).
11. As an operator, every agent action is written to `companies/ledger.db` and I
    can query the ledger to audit what happened during a run.
12. As an operator, when a Monitor-Agent cycle improves the company, `skills.md`
    is atomically overwritten with the new content.
13. As a developer, `parseModelJson` strips markdown fences and corrects missing
    leading `{` so minor model formatting deviations don't break parsing.
14. As a developer, if a task fails the quality gate, the operator task is marked
    `failed` with an `error` field, the graph continues to the monitor cycle, and
    the failure appears in `queryFailures()`.
15. As a developer, `detectProvider` correctly maps known model-ID prefixes to
    provider types and falls back to `openai` for unknown strings.

## Implementation Decisions

### Module breakdown

| Module | Contract | Complexity | Test priority |
|---|---|---|---|
| `llm/index` | `Model` interface, `detectProvider`, `createModel`, `withJsonSchema`, `parseModelJson` | Low — mostly pure functions | **High** — pure, no I/O |
| `llm/anthropic\|openai\|google\|local` | Concrete `Model` adapters | Low per adapter | Medium — mock with `Model` stub |
| `schemas` | Zod schemas, inferred types | Low | **High** — parse valid + invalid inputs |
| `ledger` | `record`, `queryFailures` | Medium — SQLite I/O | **High** — real DB in temp file |
| `companyBrain` | `write/read ContextFramework`, `write/readSkills`, `appendTaskLog` | Low — fs I/O | **High** — real fs in temp dir |
| `graph` | `runGraph(AgentState)` | Medium — orchestration logic | **High** — mock all four agents |
| `agents/idea` | `run(seed?)` → `VenturePayload` | Medium — LLM call + Zod parse | Medium — mock `createModel` |
| `agents/ceo` | `run(venture)` → `[companyId, tasks[]]` | Medium | Medium |
| `agents/operator` | `run(task)` → `OperatorTask` | High — 5-layer loop | **High** — test each layer path |
| `agents/monitor` | `run(id, tasks, cycle)` → `MonitorReport` | Medium | Medium |
| `main` | CLI arg parsing, startup credential check | Low | Low — smoke only |

### Deep modules with stable interfaces

`llm/index.ts` is the deepest module: every agent depends on it, it has no
external side effects in its pure helpers, and the `Model` interface is the
primary seam for mocking. Tests here give the highest return on investment.

`agents/operator.ts` is the most complex single file: it orchestrates five
distinct layers with branching paths (policy block, tool failure, quality gate
failure, full success). Each branch needs its own test path.

`graph.ts` is the integration seam: testing it with all four agent `run()`
functions mocked verifies the orchestration logic (skip-idea path,
parallel-operator execution, monitor loop termination) without LLM calls.

### Interface contracts

`Model.generate()` returns `Promise<string>`. When `jsonMode: true`, the string
must be parseable by `JSON.parse` after `parseModelJson` cleanup — the contract
is on the combination, not on each in isolation.

`runGraph()` accepts a partial `AgentState` and fills defaults. The
`venturePayload` field acts as the skip-idea gate.

`queryFailures()` reads from the same DB instance as `record()` — tests must
share a DB or flush state between tests.

### `MAX_MONITOR_CYCLES` mutation

`graph.ts` exports `MAX_MONITOR_CYCLES` as a `let` binding mutated by `main.ts`.
This is a known design smell. For tests, each test that exercises the loop must
set it directly before running.

## Testing Decisions

### What constitutes a good test

A test must verify behaviour through the module's public interface and survive
internal refactors. It must not make network calls, write outside a temp
directory, or depend on a real API key.

### Mocking strategy

- **`Model`** — a hand-rolled stub that implements the `Model` interface and
  returns pre-canned JSON strings. No `vi.mock` on the module level needed; pass
  the stub directly where `createModel` is called or inject it.
- **`createModel`** — mock at the module level (`vi.mock('../llm/index.js')`) in
  agent tests so `createModel()` returns the stub synchronously.
- **`DatabaseSync`** — use a real in-memory or temp-file DB. `node:sqlite` is
  synchronous; no async mocking required.
- **Filesystem** — use `os.tmpdir()` + a UUID subdirectory; clean up in
  `afterEach`.

### Which modules to test

Unit (pure functions, no I/O):
- `detectProvider` — all known prefixes + unknown fallback
- `stripProviderPrefix` — prefix variants
- `withJsonSchema` — string contains schema hint
- `parseModelJson` — fenced JSON, unfenced, missing leading `{`, invalid → throws

Schema validation (Zod parse):
- `VenturePayloadSchema` — valid input, missing field, wrong type
- `OperatorTaskSchema` — default fields applied, enum rejection
- `PolicyDecisionSchema`, `QualityGateResultSchema`, `MonitorReportSchema` — valid + invalid

Integration (real I/O, temp resources):
- `ledger.record` + `ledger.queryFailures` — write events, query filters
- `companyBrain.write/read` — round-trip context + skills, missing-file default
- `agents/operator.run` — stub `createModel`; test policy-block path, tool-failure
  path, quality-gate-fail path, happy path (all 5 layers complete)
- `graph.runGraph` — stub all four agent `run()` functions; test skip-idea path,
  monitor-loop exit on `iteration_complete`, cycle limit

### Prior art

vitest's `vi.mock` and `vi.spyOn` cover module-level stubs. For filesystem and
SQLite, real resources in temp directories are preferable to mocking `fs` and
`DatabaseSync` — they test the actual I/O contracts without complexity.

## Out of Scope

- Live LLM integration tests (require API keys, non-deterministic)
- E2B / Modal sandboxed code execution (blueprint Task 4.3 production path)
- Streaming responses
- Multi-venture concurrency (single run at a time)
- Dashboard or admin UI
- Monorepo split into `@agentverse/*` packages

## Further Notes

- `__pycache__` directories remain in `src/agents/` from before `.gitignore` was
  updated — should be removed from the working tree.
- `MAX_MONITOR_CYCLES` as a mutable module export is a test-unfriendly pattern;
  consider passing it as a `runGraph` option in a follow-up.
- The `local` provider uses the OpenAI SDK pointed at `OLLAMA_API_BASE`. If a
  user's Ollama version is older than 0.1.34, `json_object` format may silently
  be ignored — worth documenting in `.env.example`.
