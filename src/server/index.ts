import http from 'node:http';
import { createLedger, defaultDbPath } from '../ledger.js';
import { handleEventsRange, handleEventsStream } from './routes/events.js';
import { handleCompanies, handleCompany } from './routes/companies.js';

export function createServer(dbPath: string): http.Server {
  const ledger = createLedger(dbPath);

  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/events/stream') return handleEventsStream(ledger, req, res);
    if (pathname === '/events')        return handleEventsRange(ledger, req, res);
    if (pathname === '/companies')     return handleCompanies(req, res);
    if (pathname.startsWith('/companies/')) return handleCompany(req, res, pathname);

    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
  });
}

if (process.argv[1]?.endsWith('server/index.ts') || process.argv[1]?.endsWith('server/index.js')) {
  const dbPath = process.env['LEDGER_PATH'] ?? defaultDbPath();
  const port = Number(process.env['PORT'] ?? 3001);
  createServer(dbPath).listen(port, () => console.log(`Dashboard API listening on http://localhost:${port}`));
}
