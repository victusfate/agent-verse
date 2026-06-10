# PRD: Claude Code Runtime

## Problem Statement

Agent-verse currently requires a paid API key (Anthropic, OpenAI, or Google)
to run the four-agent loop, and every agent turn is a blind text completion —
agents describe artifacts in JSON strings instead of producing real files. A
developer with Claude Code installed (and its subscription auth) cannot run
the system "completely locally," and the operator agents cannot exercise real
tool use (file I/O, shell) even though the architecture was built for it.

## Solution

Add an `sdk` runtime that executes agent turns as Claude Agent SDK sessions
through the locally installed Claude Code binary and its logged-in auth. Each
agent runs as a tool-enabled session scoped to its working directory; the
operator risk gate becomes a live per-tool-call enforcement point
(`canUseTool`); actual session cost replaces token-based estimates. The
existing `api` runtime, state machine, schemas, ledger, and company brain are
unchanged. `npm start` auto-selects the `sdk` runtime when no API key is set
and `claude` is on PATH.

Canonical vocabulary: see `design.md` (Runtime, SdkModel, Agent turn, Session
context, Tool gate, Company dir, Auto-fallback, Actual cost, L2 gate).

## User Stories

1. As a developer with Claude Code installed and no API keys, I want
   `npm start` to run the full venture loop locally, so that I can use
   agent-verse on my existing Claude subscription.
2. As a developer, I want `--runtime sdk|api` (and `AGENT_RUNTIME`) to
   explicitly pick the execution backend, so that auto-detection never
   surprises me.
3. As a developer running the `sdk` runtime, I want each agent session
   scoped to the right directory with the right tools (operators: full
   file/bash in their company dir; idea/ceo/monitor: read-mostly), so that
   the engineering operator writes real artifact files instead of describing
   them.
4. As an operator of a venture, I want every tool call risk-gated live
   (path-scoped writes, policy+supervisor escalation for bash/high risk,
   fail closed when the supervisor is down), so that autonomy never outruns
   the existing safety model.
5. As a venture owner, I want the actual session cost (`total_cost_usd`)
   charged to the venture budget and `maxBudgetUsd` enforced structurally,
   so that budget accounting is ground truth, not an estimate.
6. As a developer, I want clear startup errors when the `sdk` runtime is
   selected but `claude` is missing, or when a non-Claude model is combined
   with `--runtime sdk`, so that misconfiguration fails fast at the boundary.
7. As a maintainer, I want the SDK boundary mocked in unit tests and the
   simulated provider kept for e2e, so that CI needs no Claude install.
8. As a developer using non-Claude models, I want `--model gpt-4o-mini`
   etc. to keep working exactly as today on the `api` runtime, so that the
   port is purely additive.
9. As an auditor, I want every tool-gate decision recorded to the ledger as
   telemetry (`layer: 'tool_gate'`), so that SDK sessions stay as legible as
   API turns.
10. As a developer, I want SDK session failures (`error_max_turns`,
    `error_max_budget_usd`, non-JSON results) mapped onto the existing task
    statuses (`failed`/`blocked`) and error paths, so that the monitor loop
    diagnoses them like any other friction.

## Implementation Decisions

- **New module `src/llm/sdk.ts`** — `SdkModel implements Model` wrapping
  `query()` from `@anthropic-ai/claude-agent-sdk` (new dependency). Maps
  `generate(system, prompt, options)` to one stateless session:
  `systemPrompt`, `prompt`, `model`, `cwd`, `allowedTools`,
  `permissionMode: 'dontAsk'`, `persistSession: false`, `maxTurns`,
  `maxBudgetUsd`, `canUseTool` from `options.session`. Returns the result
  text, usage, and `costUsd` from the result message. Error subtypes map to
  thrown errors whose messages name the cause (turns/budget) so operator
  error handling can set `failed` vs `blocked`.
- **Contract extensions in `src/llm/index.ts`** — `LlmProviderType` gains
  `'sdk'`; `LlmRequestOptions` gains optional `session?: SessionContext`;
  `GenerateResult` gains optional `costUsd?: number` (exact shapes in
  `design.md`). Runtime resolution implemented here: explicit flag/env →
  auto-fallback (`!ANTHROPIC_API_KEY && claude on PATH`) → `api`.
- **Tool gate in `src/llm/sdk.ts` (factory) wired by `operator.ts`** — gate
  factory takes the task + budget context and returns a `canUseTool`
  callback: read-only tools allow; `Write`/`Edit` allowed only under the
  company dir; `Bash`/other → risk classification, `high`/`critical` →
  `supervisor.evaluate()`, halt → deny; all decisions recorded via
  `ledger.record` as telemetry. Fail closed on supervisor error.
- **Operator integration** — on the `sdk` runtime, skip the prompt-based
  `policyCheck` (the gate subsumes L2) and pass session context (company dir
  cwd, operator tool set, `maxTurns: 10`, remaining budget) to
  `chargedGenerate`; charge `costUsd` when present, else the existing
  estimate.
- **Idea/CEO/Monitor integration** — pass their read-mostly session contexts
  (tool sets and cwds per `design.md`; `maxTurns: 4`). No gate — their tool
  sets are statically safe.
- **CLI and startup** — `cliArgs.ts` gains `--runtime` (validated
  `sdk|api`); `main.ts` resolves and prints the runtime, skips the API-key
  requirement for `sdk`, errors fast if `claude` is missing or the model is
  non-Claude under `sdk`.
- **No schema, ledger, brain, or graph changes.** Inter-agent communication
  model unchanged (typed payloads in memory, durable state in the company
  brain).

## Testing Decisions

- **Style:** mirror existing per-module vitest files in `src/__tests__/`,
  mocking at module boundaries (`vi.mock('@anthropic-ai/claude-agent-sdk')`),
  temp dirs via the existing `helpers.ts`/`COMPANIES_DIR` pattern.
- **Full surface coverage (confirmed):**
  - `llm.sdkModel` — query options construction (model, cwd, allowedTools,
    permissionMode, maxTurns, maxBudgetUsd), result text extraction, usage +
    `costUsd` propagation, error-subtype mapping.
  - `sdk.toolGate` — allow read-only; allow/deny path-scoped writes;
    bash escalation to supervisor (pass/mitigate/halt); fail-closed on
    supervisor error; telemetry recorded.
  - `llm.runtime` — resolution precedence (flag > env > auto-fallback >
    default), auto-fallback conditions, sdk+non-Claude-model rejection.
  - `cliArgs` — `--runtime` parsing and validation (extends existing file).
  - `operator` — sdk-runtime path: policy prompt skipped, session context
    passed, `costUsd` preferred over estimate, budget/turn errors → task
    `blocked`/`failed` (extends existing file).
- **Prior art:** `llm.cliModel.test.ts` (provider unit tests),
  `llm.detectProvider.test.ts` (resolution tests), `operator.test.ts`
  (mocked-model agent tests), `cli-agent.smoke.test.ts` (opt-in env-gated
  smoke pattern — the sdk smoke test follows it, skipped unless
  `SDK_AGENT_SMOKE=1`).
- **E2E:** the simulated provider keeps covering the full graph loop; no CI
  dependency on a Claude install.

## Out of Scope

- Rewriting orchestration on SDK sub-agents (`options.agents`) — the
  TypeScript state machine stays.
- SDK native structured outputs — the `withJsonSchema` + `parseModelJson` +
  Zod pipeline stays for both runtimes.
- Removing or changing any existing provider, including `CliModel`.
- Session persistence/resume across agent turns (the brain is the memory).
- Web dashboard visibility into SDK sessions.
- Skills/MCP exposure to agent sessions.

## Further Notes

- The SDK model option accepts full model IDs; default stays
  `claude-sonnet-4-6` via `AGENT_MODEL`. The repo's interactive setting
  (`claude-fable-5[1m]`) governs Claude Code chat sessions, not venture
  runs — worth revisiting the default later.
- `maxTurns` defaults (10 operators / 4 others) are starting points; the
  monitor's friction data will show whether they bind in practice.
- If gate denials prove frequent for legitimate engineering work (e.g.
  `npm install` in a company workspace), a per-venture allowlist in
  `context_framework.json` is the natural extension point.
