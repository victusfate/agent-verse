/**
 * Playback Engine Service (src/services/playback_engine.ts)
 * Handles recording and reading immutable simulation snapshots to ledger.db SQLite database
 * to enable deterministic record-and-replay time-travel debugging.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export let DB_PATH = path.join(__dirname, '..', '..', 'companies', 'ledger.db');
let _dbPath = DB_PATH;

export function setDbPath(newPath: string): void {
  closeDb();
  _dbPath = newPath;
}

export function closeDb(): void {
  _db = null;
}

export interface ServerContextSnapshot {
  activeCompanyId: string;
  activeAgent: string;
  currentIteration: number;
  totalCost: number;
  budgetCeiling: number;
  discountRate: number;
  paymentAmount: number;
  humanApprovalQueue: any[];
  hasPatchedCode: boolean;
}

export interface SimulationSnapshot {
  step_index: number;
  timestamp: string;
  company_id: string;
  git_sha: string;
  code_diff?: string;
  seed_prompt?: string;
  inputs: any;
  system_state: ServerContextSnapshot;
  outputs: any;
}

let _db: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!_db) {
    fs.mkdirSync(path.dirname(_dbPath), { recursive: true });
    _db = new DatabaseSync(_dbPath);
    _db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        step_index  INTEGER PRIMARY KEY,
        ts          TEXT    NOT NULL,
        company_id  TEXT    NOT NULL,
        git_sha     TEXT    NOT NULL,
        code_diff   TEXT,
        seed_prompt TEXT,
        inputs      TEXT    NOT NULL,
        system_state TEXT   NOT NULL,
        outputs     TEXT    NOT NULL
      )
    `);
  }
  return _db;
}

/**
 * Appends or overwrites a simulation step snapshot in the SQLite database.
 */
export function appendSnapshot(snapshot: SimulationSnapshot): void {
  const conn = db();
  conn.prepare(`
    INSERT INTO snapshots (step_index, ts, company_id, git_sha, code_diff, seed_prompt, inputs, system_state, outputs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(step_index) DO UPDATE SET
      ts=excluded.ts,
      company_id=excluded.company_id,
      git_sha=excluded.git_sha,
      code_diff=excluded.code_diff,
      seed_prompt=excluded.seed_prompt,
      inputs=excluded.inputs,
      system_state=excluded.system_state,
      outputs=excluded.outputs
  `).run(
    snapshot.step_index,
    snapshot.timestamp,
    snapshot.company_id,
    snapshot.git_sha,
    snapshot.code_diff ?? null,
    snapshot.seed_prompt ?? null,
    JSON.stringify(snapshot.inputs),
    JSON.stringify(snapshot.system_state),
    JSON.stringify(snapshot.outputs)
  );
}

/**
 * Retrieves all recorded snapshots from the SQLite database.
 */
export function getAllSnapshots(companyId?: string): SimulationSnapshot[] {
  const conn = db();
  let rows;
  if (companyId) {
    rows = conn.prepare(`
      SELECT step_index, ts, company_id, git_sha, code_diff, seed_prompt, inputs, system_state, outputs
      FROM snapshots
      WHERE company_id = ?
      ORDER BY step_index ASC
    `).all(companyId);
  } else {
    rows = conn.prepare(`
      SELECT step_index, ts, company_id, git_sha, code_diff, seed_prompt, inputs, system_state, outputs
      FROM snapshots
      ORDER BY step_index ASC
    `).all();
  }

  return (rows as any[]).map(r => ({
    step_index: Number(r.step_index),
    timestamp: r.ts,
    company_id: r.company_id,
    git_sha: r.git_sha,
    code_diff: r.code_diff ?? undefined,
    seed_prompt: r.seed_prompt ?? undefined,
    inputs: JSON.parse(r.inputs),
    system_state: JSON.parse(r.system_state),
    outputs: JSON.parse(r.outputs)
  }));
}

/**
 * Retrieves a single snapshot by step index from the SQLite database.
 */
export function readSnapshot(stepIndex: number): SimulationSnapshot | null {
  const conn = db();
  const row = conn.prepare(`
    SELECT step_index, ts, company_id, git_sha, code_diff, seed_prompt, inputs, system_state, outputs
    FROM snapshots
    WHERE step_index = ?
  `).get(stepIndex) as any;

  if (!row) return null;

  return {
    step_index: Number(row.step_index),
    timestamp: row.ts,
    company_id: row.company_id,
    git_sha: row.git_sha,
    code_diff: row.code_diff ?? undefined,
    seed_prompt: row.seed_prompt ?? undefined,
    inputs: JSON.parse(row.inputs),
    system_state: JSON.parse(row.system_state),
    outputs: JSON.parse(row.outputs)
  };
}

/**
 * Clears the snapshots table.
 */
export function clearHistory(): void {
  db().exec('DELETE FROM snapshots');
}
