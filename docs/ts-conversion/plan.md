# Plan — TypeScript Conversion (`ts-conversion`)

Vertical slices ordered by dependency depth (pure functions first, I/O next,
orchestration last). Each slice cuts data → logic → test.

---

## Slice 1 — LLM provider detection

**Behaviour:** `detectProvider` maps model-ID prefixes to the correct
`LlmProviderType`; `stripProviderPrefix` removes known vendor prefixes.

Tests:
- `detectProvider` → correct type for each known prefix
- `detectProvider` → `'openai'` fallback for unknown strings
- `stripProviderPrefix` → removes prefix, leaves bare ID unchanged

---

## Slice 2 — JSON parse utilities

**Behaviour:** `parseModelJson` extracts a JSON object from a raw model
response that may contain markdown fences or a missing leading `{` (Anthropic
prefill artefact). `withJsonSchema` appends a schema directive to a system
prompt.

Tests:
- `parseModelJson` clean JSON → object
- `parseModelJson` markdown-fenced JSON → object
- `parseModelJson` missing leading `{` → object (prefill case)
- `parseModelJson` invalid JSON → throws `SyntaxError`
- `withJsonSchema` → returned string contains original instruction and schema

---

## Slice 3 — Zod schema validation

**Behaviour:** `VenturePayloadSchema` and `OperatorTaskSchema` accept valid
input, apply defaults, and reject malformed input with a `ZodError`.

Tests:
- `VenturePayloadSchema.parse` valid input → typed object
- `VenturePayloadSchema.parse` missing required field → throws
- `OperatorTaskSchema.parse` valid minimal input → defaults applied
  (`task_id` uuid, `status: 'pending'`, `result: null`, `error: null`)
- `OperatorTaskSchema.parse` invalid `role` enum → throws

---

## Slice 4 — Ledger: record and query

**Behaviour:** `record` writes an append-only event row to SQLite; `queryFailures`
returns only failure-category events for a given `company_id`, leaving others
out.

Tests:
- `record` + `queryFailures` → failure event appears in results
- `record` + `queryFailures` → non-failure event does NOT appear
- `queryFailures` → empty array for company with no failures

---

## Slice 5 — Company brain: write/read round-trips

**Behaviour:** `writeContextFramework` / `readContextFramework` and
`writeSkills` / `readSkills` persist and retrieve data from the venture
directory. Missing files return safe defaults, not errors.

Tests:
- Context framework round-trip → deep-equal on read
- Skills round-trip → exact string match on read
- `readContextFramework` on missing file → `{}`
- `readSkills` on missing file → `''`

---

## Slice 6 — Operator agent: happy path

**Behaviour:** When the `Model` stub returns valid policy, tool, and quality
responses, `operator.run` progresses through all 5 layers and returns a task
with `status: 'completed'` and a non-null `result`.

Tests:
- Happy path → `status === 'completed'`
- Happy path → `result` is non-null string

---

## Slice 7 — Operator agent: failure paths

**Behaviour:** Policy block, tool-execution error, and quality gate failure each
produce a task with an appropriate `status` and a descriptive `error` field.

Tests:
- Policy `allowed: false` → `status === 'blocked'`
- Tool execution throws → `status === 'failed'`, `error` contains message
- Quality gate: short deliverable → `status === 'failed'`, `error` mentions gate

---

## Slice 8 — Graph: orchestration

**Behaviour:** `runGraph` skips the Idea-Agent when `venturePayload` is
pre-supplied, runs all three Operator tasks in parallel (all receive a
`company_id`), and stops the monitor loop when `iteration_complete` is `true`.

Tests:
- Pre-supplied venture → Idea-Agent stub NOT called
- Operator tasks all run → each returns with `company_id` set
- Monitor returns `iteration_complete: true` → loop exits after one cycle
