import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../server/index.js';

function seedDb(dbPath: string, company_id: string) {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
    company_id TEXT NOT NULL, event_type TEXT NOT NULL,
    agent_type TEXT, payload TEXT NOT NULL
  )`);
  db.prepare('INSERT INTO events (ts, company_id, event_type, agent_type, payload) VALUES (?,?,?,?,?)')
    .run(new Date().toISOString(), company_id, 'task.started', 'operator.engineering', JSON.stringify({ task_id: 'abc' }));
  db.prepare('INSERT INTO events (ts, company_id, event_type, agent_type, payload) VALUES (?,?,?,?,?)')
    .run(new Date().toISOString(), company_id, 'task.completed', 'operator.engineering', JSON.stringify({ task_id: 'abc' }));
  db.close();
}

function get(port: number, path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;
let port: number;
let tmpDir: string;
let dbPath: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-srv-'));
  dbPath = path.join(tmpDir, 'ledger.db');
  seedDb(dbPath, 'test-co');

  server = createServer(dbPath);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  await new Promise<void>((r, e) => server.close(err => err ? e(err) : r()));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ops-hardening slice 4: SAF-1
describe('Server DB setup', () => {
  it('opens the database in WAL journal mode (SAF-1)', () => {
    const db = new DatabaseSync(dbPath);
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    db.close();
    expect(row.journal_mode).toBe('wal');
  });
});

describe('GET /events', () => {
  it('returns 200 with JSON array of events for a company', async () => {
    const res = await get(port, '/events?company_id=test-co');
    expect(res.status).toBe(200);
    const rows = JSON.parse(res.body) as unknown[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by since parameter', async () => {
    const all = JSON.parse((await get(port, '/events?company_id=test-co')).body) as Array<{ id: number }>;
    const firstId = all[0]!.id;
    const after = JSON.parse((await get(port, `/events?company_id=test-co&since=${firstId}`)).body) as unknown[];
    expect(after.length).toBe(all.length - 1);
  });

  it('returns 400 when company_id is missing', async () => {
    const res = await get(port, '/events');
    expect(res.status).toBe(400);
  });
});

// ops-hardening slice 3: SAF-2
describe('GET /events — input validation', () => {
  it('returns 400 when since is non-numeric (SAF-2)', async () => {
    const res = await get(port, '/events?company_id=test-co&since=notanumber');
    expect(res.status).toBe(400);
  });

  it('returns 400 when until is non-numeric (SAF-2)', async () => {
    const res = await get(port, '/events?company_id=test-co&until=bad');
    expect(res.status).toBe(400);
  });
});

describe('GET /events/stream — input validation', () => {
  it('returns 400 when since is non-numeric on stream endpoint (SAF-2)', async () => {
    const res = await get(port, '/events/stream?company_id=test-co&since=abc');
    expect(res.status).toBe(400);
  });
});

describe('GET /events/stream', () => {
  it('responds with text/event-stream content-type', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ port, path: '/events/stream?company_id=test-co', method: 'GET' }, (res) => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        req.destroy();
        resolve();
      });
      req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e); else resolve(); });
      req.end();
    });
  });

  it('streams data: prefixed lines for existing events', async () => {
    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ port, path: '/events/stream?company_id=test-co&since=0', method: 'GET' }, (res) => {
        res.on('data', (chunk: Buffer) => {
          received.push(...chunk.toString().split('\n').filter(l => l.startsWith('data:')));
          if (received.length >= 2) { req.destroy(); resolve(); }
        });
        setTimeout(() => { req.destroy(); resolve(); }, 800);
      });
      req.on('error', (e) => { if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e); else resolve(); });
      req.end();
    });
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(received[0]!.slice(5))).toHaveProperty('event_type');
  });
});

// ── Quality rework slice 6: HTTP hygiene (F-15, F-30) ─────────────────────────

describe('server — HTTP hygiene', () => {
  it('returns 400 when since is an empty string', async () => {
    const res = await get(port, '/events?company_id=test-co&since=');
    expect(res.status).toBe(400);
  });

  it('returns 400 when since is empty on the stream endpoint', async () => {
    const res = await get(port, '/events/stream?company_id=test-co&since=');
    expect(res.status).toBe(400);
  });

  it('404 responses carry a JSON content-type', async () => {
    const res = await get(port, '/no-such-route');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('rejects non-GET methods with 405', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ port, path: '/events?company_id=test-co', method: 'POST' }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(405);
  });
});
