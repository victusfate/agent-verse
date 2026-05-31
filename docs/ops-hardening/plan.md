# ops-hardening — Implementation Plan

Vertical slices from `design.md`. Each slice: failing test(s) → fix → refactor if needed.
Ordered by severity: correctness bugs first, then safety, then debt.

---

## Slice 1 — Operator supervisor gate correctness (BUG-1 + BUG-2)

**Files:** `src/agents/operator.ts`, `src/__tests__/operator.test.ts`

**BUG-1:** After supervisor mitigates a task, `policy.allowed=false` still blocks it.
**BUG-2:** `supervisor.evaluate()` failure is caught by the outer policy try/catch and treated as non-fatal, letting a high-risk task reach the tool layer.

**Tests (RED):**
- Mitigated task with `allowed=false` original policy → status `completed`, not `blocked`
- Supervisor throws → status `failed`, not proceeding to tool execution

**Fix:**
- BUG-1: In the mitigate branch, `return` after re-assigning the task and continuing (restructure so `!policy.allowed` check is guarded by a `policyOverridden` flag, or restructure the control flow so mitigate falls through to tool execution directly)
- BUG-2: Wrap `supervisor.evaluate()` in its own inner try/catch; on error return `{ status: 'failed', error: 'Supervisor unavailable: ...' }`

---

## Slice 2 — Supervisor threshold + fixture key (BUG-3 + BUG-4)

**Files:** `src/agents/supervisor.ts`, `src/simulation/fixtures.ts`, `src/__tests__/supervisor.test.ts`, `src/__tests__/simulated.test.ts`

**BUG-3:** Hard-halt threshold `<=` should be `<`.
**BUG-4:** Fixture key `'supervisor:evaluate'` never resolves; rename to `'supervisor:policy'`.

**Tests (RED):**
- Remaining budget exactly `MIN_TASK_BUDGET_USD` → task should NOT hard-halt (passes to LLM)
- SimulatedModel with supervisor prompt → returns the supervisor fixture, not FALLBACK

**Fix:**
- BUG-3: `remaining < MIN_TASK_BUDGET_USD`
- BUG-4: Rename FIXTURES key from `'supervisor:evaluate'` to `'supervisor:policy'`

---

## Slice 3 — HTTP input validation (SAF-2 + SAF-3)

**Files:** `src/server/routes/events.ts`, `src/server/routes/companies.ts`, `src/__tests__/server.test.ts`

**SAF-2:** Non-numeric `since`/`until` → silent empty stream instead of 400.
**SAF-3:** Empty company id (double-slash URL) → 500 instead of 404.

**Tests (RED):**
- `GET /events?company_id=co&since=notanumber` → 400
- `GET /events/stream?company_id=co&since=abc` → 400
- `GET /companies//foo` → 404

**Fix:**
- After `Number(param)`, check `isNaN()` and respond 400 immediately
- After extracting `id`, guard `if (!id) { 404 }`

---

## Slice 4 — Server DB consolidation (SAF-1 + DEBT-1 + DEBT-3)

**Files:** `src/server/index.ts`, `src/server/routes/events.ts`, `src/ledger.ts`, `src/__tests__/server.test.ts`

**SAF-1:** Two `DatabaseSync` handles on the same file, no WAL mode.
**DEBT-1:** `queryEvents` and `tailEvents` duplicated verbatim from `ledger.ts`.
**DEBT-3:** `CREATE TABLE` DDL duplicated.

**Tests (RED):**
- `createServer()` called with the same db path ledger uses → no duplicate DDL, uses one handle
- `GET /events` returns the same rows as `ledger.queryEvents()` for the same input (verifies single source of truth)

**Fix:**
- Add `PRAGMA journal_mode=WAL` to `ledger.ts:initLedger()`
- Export `queryEvents` and `tailEvents` from `ledger.ts` accepting an optional `db` parameter, or accept `db` in the route handlers
- `server/index.ts`: pass the ledger `db` handle into `createServer()` instead of opening a second one; remove the duplicate DDL

---

## Slice 5 — Companies route uses companyBrain (DEBT-2)

**Files:** `src/server/routes/companies.ts`, `src/__tests__/server.test.ts`

**DEBT-2:** `handleCompany` re-implements path logic already in `companyBrain`.

**Tests (RED):**
- `GET /companies/:id` returns the same context and skills as `companyBrain.readContextFramework(id)` / `companyBrain.readSkills(id)` (not a new test — verify the existing test still passes after the refactor; add one that confirms the companyBrain module is the single source of truth)

**Fix:**
- Replace inline `fs.readFileSync` + path construction with calls to `companyBrain.readContextFramework(id)` and `companyBrain.readSkills(id)`
- Remove the local `companiesDir()` helper if it's no longer needed

---

## Slice 6 — CLI command argument parsing (DEBT-4)

**Files:** `src/llm/cli.ts`, `src/__tests__/cli.test.ts`

**DEBT-4:** `command.split(' ')` breaks any command with quoted or multi-word arguments.

**Tests (RED):**
- `new CliModel('sh -c "echo hello"')` → child receives `['sh', '-c', 'echo hello']` (3 args), not 4 broken tokens
- Existing CliModel tests still pass

**Fix:**
- Replace `this.id.split(' ')` with a minimal shell-split that respects single and double quotes (a small inline state machine — no new dependency needed)

---

## Slice order and dependencies

```
Slice 1  (BUG-1, BUG-2)  — no deps
Slice 2  (BUG-3, BUG-4)  — no deps
Slice 3  (SAF-2, SAF-3)  — no deps
Slice 4  (SAF-1, DEBT-1, DEBT-3)  — depends on ledger.ts exports added here
Slice 5  (DEBT-2)        — depends on Slice 4 (consolidated server)
Slice 6  (DEBT-4)        — no deps
```

Execute in order 1 → 2 → 3 → 4 → 5 → 6.
