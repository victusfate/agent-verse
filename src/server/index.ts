import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { handleEventsRange, handleEventsStream } from './routes/events.js';
import { handleCompanies, handleCompany } from './routes/companies.js';

export function createServer(dbPath: string): http.Server {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
    company_id TEXT NOT NULL, event_type TEXT NOT NULL,
    agent_type TEXT, payload TEXT NOT NULL
  )`);

  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/events/stream') return handleEventsStream(db, req, res);
    if (pathname === '/events')        return handleEventsRange(db, req, res);
    if (pathname === '/companies')     return handleCompanies(req, res);
    if (pathname.startsWith('/companies/')) return handleCompany(req, res, pathname);

    res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1]?.endsWith('server/index.ts') || process.argv[1]?.endsWith('server/index.js')) {
  const dbPath = process.env['LEDGER_PATH'] ?? 'companies/ledger.db';
  const port = Number(process.env['PORT'] ?? 3001);
  createServer(dbPath).listen(port, () => console.log(`Dashboard API listening on http://localhost:${port}`));
}
