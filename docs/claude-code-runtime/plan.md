# Plan: Claude Code Runtime

Vertical slices from `prd.md`. Each slice lands tests + minimal implementation
and leaves the suite green. Vocabulary per `design.md`.

## Slice 1 — SdkModel happy path (tracer bullet)
**Behavior:** `createModel(id, 'sdk')` returns an `SdkModel`; `generate(system,
prompt, {session})` invokes SDK `query()` with the mapped options
(systemPrompt, model, cwd, allowedTools, `permissionMode: 'dontAsk'`,
`persistSession: false`, maxTurns, maxBudgetUsd) and returns the result text,
usage, and `costUsd` from the result message.
**Touches:** `src/llm/sdk.ts` (new), `src/llm/index.ts` (provider type
`'sdk'`, `SessionContext`, `costUsd`, factory case), `package.json`
(dependency), `src/__tests__/llm.sdkModel.test.ts` (new, SDK mocked).

## Slice 2 — SdkModel error mapping
**Behavior:** result subtypes `error_max_turns` / `error_max_budget_usd` /
`error_during_execution` reject with errors that name the cause; the caller
can distinguish budget from turns. Cost from a failed session is still
reported when present.
**Touches:** `src/llm/sdk.ts`, `src/__tests__/llm.sdkModel.test.ts`.

## Slice 3 — Runtime resolution
**Behavior:** `resolveRuntime({flag, env})`: explicit flag wins, then
`AGENT_RUNTIME`, then auto-fallback (`!ANTHROPIC_API_KEY` and `claude` on
PATH → `sdk`), default `api`. `sdk` runtime with a non-Claude model id is
rejected with a clear error.
**Touches:** `src/llm/index.ts` (or `src/llm/runtime.ts` if it reads better),
`src/__tests__/llm.runtime.test.ts` (new).

## Slice 4 — CLI and startup wiring
**Behavior:** `--runtime sdk|api` parsed and validated (unknown value fails at
the boundary); `main.ts` resolves the runtime, prints it, requires
`ANTHROPIC_API_KEY` only for the `api`+anthropic path, and fails fast with an
install hint when `sdk` is selected but `claude` is missing.
**Touches:** `src/cliArgs.ts`, `src/main.ts`,
`src/__tests__/cliArgs.test.ts` (extend).

## Slice 5 — Tool gate
**Behavior:** gate factory (task + budget context) returns `canUseTool`:
read-only tools allow; `Write`/`Edit` inside the company dir allow, outside
deny with reason; `Bash`/other classify risk — `high`/`critical` escalate to
`supervisor.evaluate()` (halt → deny, pass/mitigate → allow); supervisor
error → deny (fail closed); every decision recorded to the ledger as
telemetry `layer: 'tool_gate'`.
**Touches:** `src/llm/sdk.ts` (or `src/agents/toolGate.ts` if cleaner),
`src/__tests__/sdk.toolGate.test.ts` (new, supervisor + ledger mocked).

## Slice 6 — Operator integration
**Behavior:** on the `sdk` runtime the operator skips the prompt-based
`policyCheck`, passes its session context (company-dir cwd, operator tool
set, `maxTurns: 10`, remaining budget, gate callback); charges `costUsd`
when present (falls back to estimate); maps budget errors → task `blocked`
and turn/execution errors → task `failed`. `api` runtime behavior unchanged.
**Touches:** `src/agents/operator.ts`,
`src/__tests__/operator.test.ts` (extend).

## Slice 7 — Idea/CEO/Monitor contexts + opt-in smoke
**Behavior:** idea/ceo/monitor pass their read-mostly session contexts
(tool sets + cwds per design, `maxTurns: 4`) on the `sdk` runtime; an opt-in
smoke test (`SDK_AGENT_SMOKE=1`) runs one real operator-style turn through
the local `claude` binary, following the `cli-agent.smoke.test.ts` pattern.
**Touches:** `src/agents/idea.ts`, `src/agents/ceo.ts`,
`src/agents/monitor.ts`, `src/__tests__/sdk-agent.smoke.test.ts` (new),
existing agent tests extended only where session context is observable.
