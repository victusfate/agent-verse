/**
 * Total Legibility Layer — append-only SQLite event ledger.
 * Every agent action, tool call, policy decision, and telemetry event is
 * written here. Nothing is ever deleted or updated.
 *
 * Uses the built-in node:sqlite module (unflagged since Node 22.13).
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCompaniesDir } from './paths.js';

const EVENTS_DDL = `
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT    NOT NULL,
    company_id TEXT    NOT NULL,
    event_type TEXT    NOT NULL,
    agent_type TEXT,
    payload    TEXT    NOT NULL
  )
`;

export function initDb(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(EVENTS_DDL);
}

export interface LedgerRow {
  id: number;
  ts: string;
  company_id: string;
  event_type: string;
  agent_type: string | null;
  payload: unknown;
}

export interface FailureRow {
  ts: string;
  event_type: string;
  agent_type: string | null;
  payload: Record<string, unknown>;
}

export interface Ledger {
  record(company_id: string, event_type: string, payload: unknown, agent_type?: string): void;
  queryEvents(company_id: string, since?: number, until?: number): LedgerRow[];
  tailEvents(company_id: string, since: number, onRow: (row: LedgerRow) => void, signal: AbortSignal): void;
  queryFailures(company_id: string): FailureRow[];
  close(): void;
}

type RawRow = { id: number; ts: string; company_id: string; event_type: string; agent_type: string | null; payload: string };

export function createLedger(dbPath: string): Ledger {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initDb(db);

  return {
    record(company_id, event_type, payload, agent_type) {
      db.prepare(
        'INSERT INTO events (ts, company_id, event_type, agent_type, payload) VALUES (?, ?, ?, ?, ?)',
      ).run(
        new Date().toISOString(),
        company_id,
        event_type,
        agent_type ?? null,
        JSON.stringify(payload),
      );
    },

    queryEvents(company_id, since, until) {
      let sql = 'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ?';
      const params: SQLInputValue[] = [company_id];
      if (since !== undefined) { sql += ' AND id > ?'; params.push(since); }
      if (until !== undefined) { sql += ' AND id <= ?'; params.push(until); }
      sql += ' ORDER BY id ASC';
      const rows = db.prepare(sql).all(...params) as RawRow[];
      return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) as unknown }));
    },

    tailEvents(company_id, since, onRow, signal) {
      let lastId = since;
      let timer: NodeJS.Timeout | null = null;
      signal.addEventListener('abort', () => {
        if (timer) { clearTimeout(timer); timer = null; }
      });
      const poll = () => {
        timer = null;
        if (signal.aborted) return;
        const rows = db.prepare(
          'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ? AND id > ? ORDER BY id ASC',
        ).all(company_id, lastId) as RawRow[];
        for (const r of rows) {
          lastId = r.id;
          onRow({ ...r, payload: JSON.parse(r.payload) as unknown });
        }
        if (!signal.aborted) timer = setTimeout(poll, 500);
      };
      poll();
    },

    queryFailures(company_id) {
      const rows = db.prepare(`
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
        payload: JSON.parse(r.payload) as Record<string, unknown>,
      }));
    },

    close() {
      db.close();
    },
  };
}

// ── Default instance (lazy) — agents call these without a handle ─────────────

export function defaultDbPath(): string {
  return path.join(resolveCompaniesDir(), 'ledger.db');
}

let _default: Ledger | null = null;

function defaultLedger(): Ledger {
  if (!_default) _default = createLedger(defaultDbPath());
  return _default;
}

export function record(
  company_id: string,
  event_type: string,
  payload: unknown,
  agent_type?: string,
): void {
  defaultLedger().record(company_id, event_type, payload, agent_type);
}

export function queryFailures(company_id: string): FailureRow[] {
  return defaultLedger().queryFailures(company_id);
}
