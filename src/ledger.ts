/**
 * Total Legibility Layer — append-only SQLite event ledger.
 * Every agent action, tool call, policy decision, and telemetry event is
 * written here. Nothing is ever deleted or updated.
 *
 * Uses the built-in node:sqlite module (Node >= 22.5, stable in 22.5+).
 * Requires: NODE_OPTIONS='--experimental-sqlite'
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.join(__dirname, '..', 'companies', 'ledger.db');

let _db: DatabaseSync | null = null;

export function initLedger(): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new DatabaseSync(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT    NOT NULL,
      company_id TEXT    NOT NULL,
      event_type TEXT    NOT NULL,
      agent_type TEXT,
      payload    TEXT    NOT NULL
    )
  `);
}

function db(): DatabaseSync {
  if (!_db) initLedger();
  return _db!;
}

export interface LedgerRow {
  id: number;
  ts: string;
  company_id: string;
  event_type: string;
  agent_type: string | null;
  payload: unknown;
}

type RawRow = { id: number; ts: string; company_id: string; event_type: string; agent_type: string | null; payload: string };

export function record(
  company_id: string,
  event_type: string,
  payload: unknown,
  agent_type?: string,
): void {
  db().prepare(
    'INSERT INTO events (ts, company_id, event_type, agent_type, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(
    new Date().toISOString(),
    company_id,
    event_type,
    agent_type ?? null,
    JSON.stringify(payload),
  );
}

export function queryEvents(company_id: string, since?: number, until?: number): LedgerRow[] {
  let sql = 'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ?';
  const params: unknown[] = [company_id];
  if (since !== undefined) { sql += ' AND id > ?'; params.push(since); }
  if (until !== undefined) { sql += ' AND id <= ?'; params.push(until); }
  sql += ' ORDER BY id ASC';
  const rows = db().prepare(sql).all(...params) as RawRow[];
  return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
}

export function tailEvents(
  company_id: string,
  since: number,
  onRow: (row: LedgerRow) => void,
  signal: AbortSignal,
): void {
  let lastId = since;
  const poll = () => {
    if (signal.aborted) return;
    const rows = db().prepare(
      'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ? AND id > ? ORDER BY id ASC',
    ).all(company_id, lastId) as RawRow[];
    for (const r of rows) {
      lastId = r.id;
      onRow({ ...r, payload: JSON.parse(r.payload) });
    }
    if (!signal.aborted) setTimeout(poll, 500);
  };
  poll();
}

export function queryFailures(company_id: string): Array<Record<string, unknown>> {
  const rows = db().prepare(`
    SELECT ts, event_type, agent_type, payload
    FROM   events
    WHERE  company_id = ?
      AND  (
        event_type LIKE '%.failed'
        OR event_type LIKE '%.error'
        OR event_type = 'human.escalation_required'
        OR json_extract(payload, '$.success') = 0
      )
    ORDER BY id DESC
    LIMIT 20
  `).all(company_id) as Array<{ ts: string; event_type: string; agent_type: string | null; payload: string }>;

  return rows.map(r => ({
    ts: r.ts,
    event_type: r.event_type,
    agent_type: r.agent_type,
    ...JSON.parse(r.payload),
  }));
}
