# ops-hardening — Design Doc

Code review findings from the `autonomous-ops` feature. Organized into three tiers: correctness bugs, safety/reliability issues, and structural debt.

---

## Canonical Vocabulary

| Term | Meaning |
|---|---|
| **policy** | L2 `PolicyDecision` returned by `policyCheck()` — may say `allowed=false` and/or `escalate_to_human=true` |
| **supervisor gate** | `supervisor.evaluate()` call in L2 — the autonomous replacement for the human gate |
| **mitigation** | Supervisor action that narrows task scope and re-enables execution |
| **hard halt** | Pre-LLM budget check in supervisor that skips the model call entirely |
| **WAL mode** | SQLite Write-Ahead Logging — required for safe concurrent readers + writer |
| **fixture key** | `${role}:${layer}` string used to look up canned responses in `SimulatedModel` |
| **playhead** | Client-side cursor tracking which ledger event the dashboard is viewing |

---

## Tier 1 — Correctness Bugs

These produce wrong observable behavior today.

### BUG-1 · Stale `policy.allowed` blocks mitigated tasks

**File:** `src/agents/operator.ts:167`

**What happens:** When a policy returns `{ allowed: false, escalate_to_human: true }`, the supervisor is invoked. If it responds with `action: 'mitigate'`, the task is re-assigned — but `policy` is never updated. The immediately following `if (!policy.allowed)` check still sees the original `false`, returns `status: 'blocked'`, and silently discards the mitigated task.

**Failure scenario:** Any high-risk task that the policy blocks outright but the supervisor wants to narrow and allow will always be blocked, making mitigation a dead code path in practice.

**Fix:** After a successful `mitigate` action, either set a local flag (`let policyOverridden = false`) or `return` early from the supervisor block rather than falling through to the `!policy.allowed` check.

---

### BUG-2 · `supervisor.evaluate()` failure bypasses the supervisor gate

**File:** `src/agents/operator.ts:170`

**What happens:** `policyCheck()` and `supervisor.evaluate()` share a single `try/catch`. If `supervisor.evaluate()` throws (network timeout, model error, etc.), the catch block logs the error, marks telemetry failed, and continues with the comment "Non-fatal — continue with execution." The task proceeds to L3 tool execution without any supervisor check.

**Failure scenario:** A task flagged `escalate_to_human: true` (high or critical risk) passes straight to the tool layer whenever the supervisor LLM call fails. This is the precise scenario the supervisor gate exists to prevent.

**Fix:** Split the supervisor call into its own `try/catch` with a fail-closed policy: on supervisor error, return `{ ...task, status: 'failed', error: 'Supervisor unavailable: ...' }` rather than continuing.

---

### BUG-3 · `SimulatedModel` supervisor fixture key is permanently unreachable

**File:** `src/simulation/fixtures.ts:64`

**What happens:** `LAYER_KEYWORDS` maps the string `'Evaluate this task'` to layer `'policy'`. `supervisor.ts` generates the prompt `"Evaluate this task:\n..."`, so `resolveKey()` always produces `'supervisor:policy'`. `FIXTURES` has no `'supervisor:policy'` entry — it has `'supervisor:evaluate'`, which would require a layer keyword `'evaluate'` that doesn't exist anywhere in `LAYER_KEYWORDS`.

**Result:** Every `SimulatedModel` supervisor call emits `[SimulatedModel] No fixture for key "supervisor:policy"` and falls back to the generic `TOOL_OUTPUT` fixture, making supervisor-path simulation untestable.

**Fix:** Rename the `FIXTURES` key from `'supervisor:evaluate'` to `'supervisor:policy'`, or add `'Evaluate this task'` as a keyword mapping to layer `'evaluate'` — whichever matches intent.

---

### BUG-4 · `supervisor.ts` hard-halt threshold uses `<=` instead of `<`

**File:** `src/agents/supervisor.ts:37`

**What happens:** `remaining <= MIN_TASK_BUDGET_USD` halts when exactly `$0.05` remains. The intent of `MIN_TASK_BUDGET_USD = 0.05` is "halt when *less than* the minimum remains," not "halt when the minimum is exactly available."

**Failure scenario:** `token_budget_usd=10.05, tokens_consumed_usd=10.0` → `remaining=0.05` → immediate halt even though the declared minimum is present.

**Fix:** Change `<=` to `<`.

---

## Tier 2 — Safety & Reliability

These don't crash today but create real risk at scale or under adversarial conditions.

### SAF-1 · Two `DatabaseSync` handles on the same SQLite file, no WAL mode

**File:** `src/server/index.ts:7`

**What happens:** `server/index.ts` opens its own `new DatabaseSync(dbPath)` for queries/SSE, while `ledger.ts` holds a separate singleton handle for writes. Neither configures `PRAGMA journal_mode=WAL`. When the server and agents share the same Node process (the normal `npm run dashboard` path), both handles write to the same file concurrently. Without WAL, SQLite uses exclusive locking — the second writer gets `SQLITE_BUSY` and the connection crashes.

**Fix:** Either pass the ledger's `db` handle into `createServer()` so there is one handle, or at minimum run `PRAGMA journal_mode=WAL` in both open calls.

---

### SAF-2 · Non-numeric `since` parameter yields a silent 200-OK empty stream

**File:** `src/server/routes/events.ts:19–29`

**What happens:** `since` and `until` are parsed with bare `Number(queryParam)`. `Number('abc') = NaN`. `NaN` flows into `queryEvents()` as the `since` argument, producing `WHERE id > NaN` in SQLite (treated as `WHERE id > NULL`) — matching nothing. The SSE stream opens with status 200 but delivers zero events, including all pre-existing history.

**Fix:** Add `isNaN(since) ? res.writeHead(400) : ...` validation, or replace `Number()` with a strict integer parser that returns `null` on invalid input and responds 400.

---

### SAF-3 · Malformed company URL produces 500 instead of 404

**File:** `src/server/routes/companies.ts:21`

**What happens:** `pathname.replace('/companies/', '').split('/')[0]` yields an empty string `''` when `pathname` is `/companies//anything` (double slash). `path.join(companiesDir(), '')` resolves to `companiesDir()` itself. `fs.existsSync` on the companies directory returns `true`, then reading `context_framework.json` in the root companies directory throws `ENOENT` → 500.

**Fix:** After extracting `id`, guard with `if (!id) { res.writeHead(404); res.end(); return; }`.

---

## Tier 3 — Structural Debt

These don't cause immediate failures but create divergence and maintenance burden.

### DEBT-1 · `queryEvents` duplicated verbatim from `ledger.ts`

**File:** `src/server/routes/events.ts:6`

`events.ts` contains a full reimplementation of `queryEvents` (same SQL, same `RawRow` type, same `JSON.parse` step) instead of importing from `ledger.ts`. The `handleEventsStream` function similarly re-implements `tailEvents` with a boolean `aborted` flag instead of `AbortSignal`.

**Cost:** Any SQL fix or schema change applied to `ledger.ts` is silently absent from the server path. The `/events` REST endpoint and the SSE stream can diverge from `ledger.queryEvents` and `ledger.tailEvents` without any type error or test failure.

**Fix:** Export `queryEvents` from `ledger.ts` with a `db` parameter (or re-export the module-level version), and import it in `events.ts`. Do the same for `tailEvents`.

---

### DEBT-2 · `handleCompany` duplicates `companyBrain` path logic

**File:** `src/server/routes/companies.ts:27`

`companies.ts` re-implements path construction and `fs.readFileSync` calls that are already encapsulated in `companyBrain.readContextFramework()` and `companyBrain.readSkills()`. The two implementations agree on the cwd-relative `companies/` root today, but drift silently on any refactor.

**Fix:** Import and call `companyBrain.readContextFramework(id)` and `companyBrain.readSkills(id)` directly.

---

### DEBT-3 · CREATE TABLE DDL duplicated between `ledger.ts` and `server/index.ts`

**File:** `src/server/index.ts:7` / `src/ledger.ts`

`server/index.ts` issues its own `CREATE TABLE IF NOT EXISTS events` when opening its DB handle, duplicating the schema definition in `ledger.ts:initLedger()`. Adding a column requires two edits; a NOT NULL constraint added in one place is silently absent in the other.

**Fix:** Expose `initLedger(db)` as an overload that accepts an external handle, or export the DDL string as a constant, so both call sites share one source of truth.

---

### DEBT-4 · CLI command split on whitespace breaks quoted arguments

**File:** `src/llm/cli.ts:18`

`this.id.split(' ')` is used to derive `[cmd, ...args]` for `child_process.spawn`. Any command with shell quoting or space-containing flag values (e.g. `sh -c "echo hello"`) is silently mis-split.

**Cost:** Low today because `CliModel` is typically used with simple commands (`claude`, `cat`), but fails unexpectedly the moment a user passes a compound command.

**Fix:** Either document that quoted arguments are unsupported, or use a minimal shell-split utility (e.g. `shellSplit` from a micro-lib, or a simple state-machine over the string).

---

## Summary Table

| ID | File | Tier | One-liner |
|---|---|---|---|
| BUG-1 | `agents/operator.ts:167` | Correctness | Stale `policy.allowed` blocks mitigated tasks |
| BUG-2 | `agents/operator.ts:170` | Correctness | Supervisor failure bypasses gate |
| BUG-3 | `simulation/fixtures.ts:64` | Correctness | Supervisor fixture key unreachable |
| BUG-4 | `agents/supervisor.ts:37` | Correctness | Hard-halt uses `<=` should be `<` |
| SAF-1 | `server/index.ts:7` | Safety | Dual DB handles, no WAL mode |
| SAF-2 | `server/routes/events.ts:19` | Safety | NaN `since` → silent empty stream |
| SAF-3 | `server/routes/companies.ts:21` | Safety | Empty company id → 500 not 404 |
| DEBT-1 | `server/routes/events.ts:6` | Debt | `queryEvents`/`tailEvents` duplicated |
| DEBT-2 | `server/routes/companies.ts:27` | Debt | `companyBrain` path logic re-implemented |
| DEBT-3 | `server/index.ts:7` | Debt | CREATE TABLE DDL duplicated |
| DEBT-4 | `llm/cli.ts:18` | Debt | CLI command split breaks quoted args |
