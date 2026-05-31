# PRD — Deterministic Playback Engine & Compiler-Gated Self-Healing (`time-travel-replay`)

This document defines the functional requirements and product specifications for the **Deterministic Playback Engine** and **Compiler-Gated Self-Healing Loop** in the `agent_verse` TypeScript corporate AI ecosystem.

---

## 1. Functional Requirements

### 1.1 Web Simulation Server & Websockets
* **Server Node**: The CLI graph environment will be upgraded to also run an Express HTTP server coupled with a WebSockets telemetry channel on `http://localhost:3000`.
* **State Broadcasts**: The server must broadcast active state parameters (`activeCompanyId`, `activeAgent`, `currentIteration`, `totalCost`, `budgetCeiling`, `discountRate`, `humanApprovalQueue`, `patchedState`) to all connected dashboard clients at regular intervals (1 second) and immediately upon state mutations.
* **Ledger Stream**: Every log written to the append-only SQLite ledger must be mirrored over WebSockets to support real-time visual streaming on the terminal panel.

### 1.2 Consolidated SQLite Playback Engine
* **snapshots table schema**:
  ```sql
  CREATE TABLE IF NOT EXISTS snapshots (
    step_index  INTEGER PRIMARY KEY,
    ts          TEXT    NOT NULL,
    git_sha     TEXT    NOT NULL,
    code_diff   TEXT,
    seed_prompt TEXT,
    inputs      TEXT    NOT NULL,  -- JSON string of SensorPayload
    system_state TEXT   NOT NULL,  -- JSON string of ServerContextState
    outputs     TEXT    NOT NULL   -- JSON string of output telemetry
  );
  ```
* **Telemetric Interceptor**: The central telemetry logging engine (`logToLedger`) must automatically capture and write a full `SimulationSnapshot` to the `snapshots` SQLite table at the completion of Layer 5 (`learning`) of every step.

### 1.3 Time-Travel API Endpoints
* `GET /api/state`: Retrieves the current real-time in-memory state of the simulation.
* `GET /api/ledger`: Retrieves all historical logs from the SQLite `events` ledger.
* `GET /api/history/steps`: Retrieves a complete listing of all recorded `SimulationSnapshot` steps from SQLite (ordered by `step_index`).
* `GET /api/history/step/:index`: Retrieves a single `SimulationSnapshot` record by its `step_index`.
* `POST /api/history/clear`: Wipes the `snapshots` and `events` tables and resets the system's runtime iteration parameters.
* `POST /api/action`: Coordinates administrative overrides and manual supervisor gates (e.g. launching ventures, injecting friction, trigger payment requests, human gate approvals/rejections, and budget ceiling mutations).

### 1.4 Glassmorphic UI & Playback Controls Console
* **Glassmorphic Layout**: Premium dark-mode interface styled with tailored fonts (Outfit, JetBrains Mono), smooth translucent panels, subtle hover scale/glow animations, and background animated gradients.
* **State Topology**: An active visual topology map showing the four agents (Idea, CEO, Operators, Monitor) and the Human gate, lighting up active nodes dynamically based on WebSocket telemetry.
* **Time-Travel Console**:
  * Timeline range slider indicating current scrubbing position.
  * Controls: ⏮️ (First Step), ◀️ (Step Backward), ⏸️ (Pause / Stop), ▶️ (Play forward at 1 step/sec), ▶️▶️ (Fast-Forward at 300ms/step), ⏭️ (Resume Live stream).
  * History Clear button to reset simulation records.

### 1.5 Dynamic Compiler-Gated Self-Healing Loop
* **Friction Ingestion**: If `discountRate = 1.0` is injected, the mathematical service throws a division-by-zero or calculation assertion exception.
* **Immediate Catch**: The Operator Agent intercepts the exception, logs a `TECHNICAL_FRICTION` warning, halts operator routines, and dispatches an immediate execution transfer to the `Monitor-Agent`.
* **TypeScript Patch Generation**: The `Monitor-Agent` calls the reasoning engine to write a corrected version of `src/services/calculator_service.ts`.
* **Compiler Gate**: Runs `npx tsc --noEmit` locally in the workspace. Any typescript or syntactical compile errors trigger an immediate rollback to the previous source state and abort the heal.
* **In-Process Dry-Run**: Programmatically dynamic-imports the healed module (`services/calculator_service.ts?update=now`) and executes validation assertions. Any invalid results trigger a rollback.
* **Hot-Swap & Resume**: On complete pass, hot-swaps the active service module, appends heuristics to `skills.md`, updates current iteration indicators, resets `discountRate` to safe `0.1`, and triggers Operator resumption.

---

## 2. API JSON Schemas

### 2.1 SimulationSnapshot Schema
```json
{
  "step_index": 1,
  "timestamp": "2026-05-31T17:00:00.000Z",
  "git_sha": "857ffa4",
  "code_diff": "export function calculateFinancials...",
  "seed_prompt": "invoice processing engine",
  "inputs": {
    "eventId": "ev_abc123",
    "timestamp": "2026-05-31T17:00:00.000Z",
    "type": "FINANCIAL_CALCULATION",
    "payload": {
      "revenue": 10000,
      "expenses": 3000,
      "discountRate": 1.0
    }
  },
  "system_state": {
    "activeCompanyId": "invoice-reconcile-api",
    "activeAgent": "Operator-Agents",
    "currentIteration": 1,
    "totalCost": 0.45,
    "budgetCeiling": 50.00,
    "discountRate": 1.0,
    "paymentAmount": 750.00,
    "humanApprovalQueue": [],
    "hasPatchedCode": false
  },
  "outputs": {
    "status": "SUCCESS",
    "message": "Financial calculation completed successfully.",
    "toolOutput": {
      "netProfit": 7000
    }
  }
}
```

---

## 3. Verification Plan

### 3.1 Automated Testing
* **Playback API Tests**: Validate `/api/history/*` endpoint actions, snapshot reading, writes, and database clears under Vitest.
* **Service Type Assertions**: Test type narrowing on discriminated unions and correctness assertions under Vitest.

### 3.2 Manual System Verification
* Start server using `npm run dev` and navigate to `http://localhost:3000`.
* Inject `Friction` to trigger a system crash. Inspect visual indicators to confirm:
  1. Operator halts and transitions to Monitor-Agent.
  2. Monitor-Agent compiles patch, passes the compiler gate, and programmatically dry-runs validation.
  3. Patch is hot-swapped, `skills.md` is updated, and operators resume and complete successfully.
* Verify time-travel controller steps back and forward perfectly reconstructs past metrics, animated highlight rings, and terminal displays.
