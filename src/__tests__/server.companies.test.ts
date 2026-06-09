import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../server/index.js';

function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

let server: http.Server;
let port: number;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-co-'));
  const dbPath = path.join(tmpDir, 'ledger.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, company_id TEXT NOT NULL, event_type TEXT NOT NULL, agent_type TEXT, payload TEXT NOT NULL)');
  db.close();

  // Seed a company directory
  const coDir = path.join(tmpDir, 'companies', 'acme-co');
  fs.mkdirSync(coDir, { recursive: true });
  fs.writeFileSync(path.join(coDir, 'context_framework.json'), JSON.stringify({ mission: 'Test', token_budget_usd: 10 }));
  fs.writeFileSync(path.join(coDir, 'skills.md'), '# Skills\n');
  fs.writeFileSync(path.join(coDir, 'task_log.jsonl'), JSON.stringify({ task_id: 'x', status: 'completed' }) + '\n');

  process.env['COMPANIES_DIR'] = path.join(tmpDir, 'companies');
  server = createServer(dbPath);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterEach(async () => {
  await new Promise<void>((r, e) => server.close(err => err ? e(err) : r()));
  delete process.env['COMPANIES_DIR'];
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /companies', () => {
  it('returns 200 with JSON array', async () => {
    const res = await get(port, '/companies');
    expect(res.status).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

describe('GET /companies/:id', () => {
  it('returns company context, skills, and tasks for a known company', async () => {
    const res = await get(port, '/companies/acme-co');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { id: string; context: { mission: string }; skills: string; tasks: unknown[] };
    expect(body.id).toBe('acme-co');
    expect(body.context.mission).toBe('Test');
    expect(body.skills).toContain('# Skills');
    expect(body.tasks).toHaveLength(1);
    expect(body).not.toHaveProperty('task_count');
  });

  it('returns 404 for an unknown company', async () => {
    const res = await get(port, '/companies/unknown-co');
    expect(res.status).toBe(404);
  });

  // ops-hardening slice 3: SAF-3
  it('returns 404 (not 500) for double-slash URL with empty id (SAF-3)', async () => {
    const res = await get(port, '/companies//foo');
    expect(res.status).toBe(404);
  });
});
