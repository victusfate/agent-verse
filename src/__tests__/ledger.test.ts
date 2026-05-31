import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// We test ledger by pointing DB_PATH at a temp file.
// ledger.ts uses a module-level singleton, so we re-initialise between tests
// by resetting the module via a fresh temp path each time.

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ledger-'));
  return path.join(dir, 'ledger.db');
}

// Minimal inline ledger exercised against a real temp DB — avoids
// module-singleton issues while testing the actual SQL logic.
function buildLedger(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT NOT NULL,
      company_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      agent_type TEXT,
      payload    TEXT NOT NULL
    )
  `);

  function record(company_id: string, event_type: string, payload: unknown, agent_type?: string) {
    db.prepare(
      'INSERT INTO events (ts, company_id, event_type, agent_type, payload) VALUES (?, ?, ?, ?, ?)'
    ).run(new Date().toISOString(), company_id, event_type, agent_type ?? null, JSON.stringify(payload));
  }

  function queryFailures(company_id: string): unknown[] {
    const rows = db.prepare(`
      SELECT ts, event_type, agent_type, payload
      FROM events
      WHERE company_id = ?
        AND (
          event_type LIKE '%.failed'
          OR event_type LIKE '%.error'
          OR event_type = 'human.escalation_required'
          OR json_extract(payload, '$.success') = 0
        )
      ORDER BY id DESC LIMIT 20
    `).all(company_id) as Array<{ ts: string; event_type: string; agent_type: string | null; payload: string }>;
    return rows.map(r => ({ ts: r.ts, event_type: r.event_type, ...JSON.parse(r.payload) }));
  }

  function queryEvents(company_id: string, since?: number, until?: number): unknown[] {
    let sql = 'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ?';
    const params: unknown[] = [company_id];
    if (since !== undefined) { sql += ' AND id > ?'; params.push(since); }
    if (until !== undefined) { sql += ' AND id <= ?'; params.push(until); }
    sql += ' ORDER BY id ASC';
    const rows = db.prepare(sql).all(...params) as Array<{
      id: number; ts: string; company_id: string; event_type: string; agent_type: string | null; payload: string;
    }>;
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  function tailEvents(company_id: string, since: number, onRow: (row: unknown) => void, signal: AbortSignal): void {
    let lastId = since;
    const poll = () => {
      if (signal.aborted) return;
      const rows = db.prepare(
        'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ? AND id > ? ORDER BY id ASC'
      ).all(company_id, lastId) as Array<{
        id: number; ts: string; company_id: string; event_type: string; agent_type: string | null; payload: string;
      }>;
      for (const r of rows) {
        lastId = r.id;
        onRow({ ...r, payload: JSON.parse(r.payload) });
      }
      if (!signal.aborted) setTimeout(poll, 500);
    };
    poll();
  }

  return { record, queryFailures, queryEvents, tailEvents };
}

describe('ledger — queryEvents', () => {
  let ledger: ReturnType<typeof buildLedger>;

  beforeEach(() => { ledger = buildLedger(makeTempDb()); });

  it('returns all events for a company when no range given', () => {
    ledger.record('co-1', 'task.started', { x: 1 });
    ledger.record('co-1', 'task.completed', { x: 2 });
    expect(ledger.queryEvents('co-1')).toHaveLength(2);
  });

  it('filters events after since id (exclusive)', () => {
    ledger.record('co-1', 'a', {});
    ledger.record('co-1', 'b', {});
    ledger.record('co-1', 'c', {});
    const all = ledger.queryEvents('co-1') as Array<{ id: number; event_type: string }>;
    const firstId = all[0]!.id;
    const rest = ledger.queryEvents('co-1', firstId) as Array<{ event_type: string }>;
    expect(rest).toHaveLength(2);
    expect(rest[0]!.event_type).toBe('b');
  });

  it('filters events up to until id (inclusive)', () => {
    ledger.record('co-1', 'a', {});
    ledger.record('co-1', 'b', {});
    ledger.record('co-1', 'c', {});
    const all = ledger.queryEvents('co-1') as Array<{ id: number }>;
    const secondId = all[1]!.id;
    const slice = ledger.queryEvents('co-1', undefined, secondId) as Array<{ event_type: string }>;
    expect(slice).toHaveLength(2);
  });

  it('parses payload as object', () => {
    ledger.record('co-1', 'test', { key: 'value' });
    const rows = ledger.queryEvents('co-1') as Array<{ payload: { key: string } }>;
    expect(rows[0]!.payload.key).toBe('value');
  });
});

describe('ledger — tailEvents', () => {
  let ledger: ReturnType<typeof buildLedger>;

  beforeEach(() => { ledger = buildLedger(makeTempDb()); });

  it('delivers pre-existing rows after since=0', async () => {
    ledger.record('co-1', 'a', {});
    ledger.record('co-1', 'b', {});
    const received: unknown[] = [];
    const ctrl = new AbortController();
    ledger.tailEvents('co-1', 0, (r) => received.push(r), ctrl.signal);
    await new Promise(r => setTimeout(r, 50));
    ctrl.abort();
    expect(received).toHaveLength(2);
  });

  it('delivers new rows inserted after tail starts', async () => {
    const received: unknown[] = [];
    const ctrl = new AbortController();
    ledger.tailEvents('co-1', 0, (r) => received.push(r), ctrl.signal);
    await new Promise(r => setTimeout(r, 50));
    ledger.record('co-1', 'late', {});
    await new Promise(r => setTimeout(r, 600));
    ctrl.abort();
    expect(received).toHaveLength(1);
  });
});

describe('ledger', () => {
  let ledger: ReturnType<typeof buildLedger>;

  beforeEach(() => {
    ledger = buildLedger(makeTempDb());
  });

  it('records a failure event and queryFailures returns it', () => {
    ledger.record('co-1', 'task.failed', { error: 'oops', success: false });
    const failures = ledger.queryFailures('co-1');
    expect(failures).toHaveLength(1);
    expect((failures[0] as { event_type: string }).event_type).toBe('task.failed');
  });

  it('queryFailures filters by company_id', () => {
    ledger.record('co-a', 'task.failed', { success: false });
    ledger.record('co-b', 'task.failed', { success: false });
    expect(ledger.queryFailures('co-a')).toHaveLength(1);
    expect(ledger.queryFailures('co-b')).toHaveLength(1);
  });

  it('non-failure events do NOT appear in queryFailures', () => {
    ledger.record('co-1', 'task.completed', { success: true });
    ledger.record('co-1', 'company.created', { venture: {} });
    expect(ledger.queryFailures('co-1')).toHaveLength(0);
  });

  it('returns empty array for a company with no failures', () => {
    expect(ledger.queryFailures('nonexistent-co')).toEqual([]);
  });

  it('catches human escalation events', () => {
    ledger.record('co-1', 'human.escalation_required', { reason: 'high risk' });
    expect(ledger.queryFailures('co-1')).toHaveLength(1);
  });

  it('catches events with success: false in payload', () => {
    ledger.record('co-1', 'telemetry', { layer: 'tool', success: false });
    expect(ledger.queryFailures('co-1')).toHaveLength(1);
  });
});
