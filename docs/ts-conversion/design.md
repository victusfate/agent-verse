# Design — TypeScript Conversion (`ts-conversion`)

## Goal

Replace the Python implementation of agent-verse with a TypeScript implementation
that preserves the four-agent corporate AI ecosystem described in the blueprint,
while adhering to the scaffold workflow (AGENTS.md).

## Canonical Vocabulary

| Term | Meaning |
|---|---|
| `Model` | A single LLM endpoint. Implements the `generate()` contract. One instance per (provider, model-id). |
| `LlmProviderType` | Union of `'google' \| 'openai' \| 'anthropic' \| 'local'`. `local` = Ollama or any OpenAI-compatible self-hosted endpoint. |
| `jsonMode` | When `true`, the Model must coerce the response into a parseable JSON string. Each provider implements this in its own native way. |
| Provider adapter | Concrete `Model` implementation that wraps one provider's SDK and translates the unified options into provider-native calls. |
| Company brain | Per-venture `context_framework.json` + `skills.md`, written to `companies/<id>/`. |
| Ledger | Append-only event log. One row per agent action, tool call, policy decision, or telemetry event. |
| Operator role | One of `product`, `engineering`, `customer-success`. All three share the 5-layer execution loop. |

## Resolved Decisions

### D1 — Package layout: single package, not monorepo

The Python tree is flat and small (~800 LOC). Mirror it in TypeScript with one
`package.json` at the root. A monorepo split (`@agentverse/core`, etc.) is a
valid v2 move but adds tooling overhead before we have a working system.

### D2 — LLM contract: unified `Model` interface, JSON-mode for structure

Adopted verbatim from the user's specification:

```typescript
export type LlmProviderType = 'google' | 'openai' | 'anthropic' | 'local';

export interface LlmRequestOptions {
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface Model {
  id: string;
  provider: LlmProviderType;
  generate(
    systemInstruction: string,
    prompt: string,
    options?: LlmRequestOptions
  ): Promise<string>;
}
```

Rationale:
- Single method, single return type — easy to substitute and mock.
- `jsonMode` is the structural-output knob. Each provider translates it natively:
  - **OpenAI:** `response_format: { type: 'json_object' }` (or `json_schema` when a Zod schema is supplied).
  - **Google Gemini:** `generationConfig.responseMimeType: 'application/json'`.
  - **Anthropic:** no native JSON mode → use prompt directive + assistant prefill of `{` (default), or single-tool-call fallback if prefill is unreliable.
  - **Local (Ollama):** `format: 'json'`.
- Caller is responsible for parsing the returned string and validating it (Zod).
- Tool-call abstractions are intentionally **not** exposed at this layer — they
  add per-provider complexity without giving us anything we can't get from
  `jsonMode` + prompt-embedded schema.

Provider adapters (one file per provider, using direct SDKs — not an intermediary like token.js):

```
src/llm/
  index.ts           # exports Model, LlmProviderType, LlmRequestOptions, factory()
  anthropic.ts       # AnthropicModel  — @anthropic-ai/sdk (latest)
  openai.ts          # OpenAIModel     — openai SDK
  google.ts          # GoogleModel     — @google/generative-ai
  local.ts           # LocalModel      — openai SDK pointed at OLLAMA_API_BASE (OpenAI-compat)
```

token.js was evaluated and rejected: last release 1 year ago (likely abandoned),
bundles all 9 provider SDKs unconditionally (adds weight regardless of usage),
ships a very old `@anthropic-ai/sdk@0.24.3` missing prompt caching and streaming
improvements, and has no Ollama support. Direct adapters are ~50–80 lines each
and stay on current SDK versions.

`factory(modelId, provider)` returns the right `Model` instance, reading API
keys from env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`OLLAMA_API_BASE`).

## Open Questions

- D3 — Runtime: Node 22 vs Bun? (pending)
- D4 — State graph: custom (mirror `graph.py`) vs LangGraph.js? (pending)
- D5 — Test framework + build tool? (pending)
- D6 — Validation library: Zod is the obvious default. Confirm. (pending)
- D7 — Python tree: remove entirely or keep as `python-legacy/`? (pending — user said "full conversion" → leaning remove)

## Architecture (preview, subject to remaining decisions)

```
src/
  llm/                  # Model interface + 4 provider adapters
  agents/               # idea, ceo, operator, monitor
  graph.ts              # state graph wiring agents together
  ledger.ts             # append-only SQLite event log
  companyBrain.ts       # context_framework.json + skills.md per venture
  schemas.ts            # Zod schemas (VenturePayload, OperatorTask, etc.)
  main.ts               # CLI entry point
```
