# Plan — Deterministic Playback Engine & Self-Healing (`time-travel-replay`)

Vertical slices ordered by dependencies (pure libraries/tooling first, API endpoints next, UI interfaces next, dynamic loop orchestration last). Each slice cuts data $\rightarrow$ logic $\rightarrow$ UI $\rightarrow$ test.

---

## Slice 1 — Tooling & Setup
* **Goal:** Configure dependencies and compiler options to support dynamic backend endpoints.
* **Tasks:**
  * Install `express`, `ws`, and `fs-extra` and their typescript type packages.
  * Register `"dev": "tsx src/server.ts"` and server start scripts inside `package.json`.
  * Verify full project type-checking passes cleanly via `npm run typecheck`.

---

## Slice 2 — Playback Engine & History API
* **Goal:** Implement persistent SQLite step snapshot logging and retrieval endpoints.
* **Tasks:**
  * Create `src/services/playback_engine.ts` with SQLite statements to manage `snapshots` table creation, records appending, reads, and clears.
  * Register `/api/history/steps`, `/api/history/step/:index`, and `/api/history/clear` Express routers.
  * Integrate snapshot-appending telemetry logic into the ledger transaction logger.

---

## Slice 3 — Deterministic Services & ESM Cache Bypass
* **Goal:** Implement core mathematical and processing services with built-in friction spots.
* **Tasks:**
  * Create `src/services/calculator_service.ts` (with a deliberate division-by-zero bug on `discountRate = 1.0`).
  * Create `src/services/payment_service.ts` for Stripe transactions execution.
  * Configure operator imports utilizingURL parameters (`?update=Date.now()`) to bypass ESM loader caching.

---

## Slice 4 — Premium Visual Dashboard & Replay Controller
* **Goal:** Construct a stunning glassmorphic UI visualization panel with complete time-travel controls.
* **Tasks:**
  * Create `public/index.html` with translucent glassmorphism grids, topology maps, timeline scrubbers, and playback controls.
  * Create `public/style.css` containing animated glow background gradients, font configurations, and responsive structures.
  * Create `public/app.js` with WebSocket telemetry connections, SVG topological connections, and client-side playback state machine.

---

## Slice 5 — Compiler-Gated Self-Healing Loop
* **Goal:** Implement the full self-improving loop in Monitor and Operator agents.
* **Tasks:**
  * Update `src/agents/operator.ts` to execute services and capture exception crashes immediately.
  * Update `src/agents/monitor.ts` to implement patch synthesis, local `npx tsc --noEmit` compiler checks, dynamic imports programmatic dry-runs, and `skills.md` heuristics integration.
  * Implement `src/server.ts` coordinating the master state-graph runners, WebSocket streams, and Express controllers.

---

## Slice 6 — Vitest Automated Test Suite
* **Goal:** Verify system type boundaries and playback stability via offline tests.
* **Tasks:**
  * Create `src/__tests__/playback_engine.test.ts` asserting snapshot writing, indexing, reading, and clearing in SQLite.
  * Create `src/__tests__/type_assertion.test.ts` asserting calculator division and payment boundary checks.
  * Verify all Vitest test suites compile and pass successfully.
