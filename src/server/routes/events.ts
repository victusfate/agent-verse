import type http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { queryEventsFromDb, tailEventsFromDb } from '../../ledger.js';

export function handleEventsRange(db: DatabaseSync, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const company_id = url.searchParams.get('company_id');
  if (!company_id) { res.writeHead(400).end(JSON.stringify({ error: 'company_id required' })); return; }
  const sinceRaw = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : undefined;
  const untilRaw = url.searchParams.has('until') ? Number(url.searchParams.get('until')) : undefined;
  if (sinceRaw !== undefined && isNaN(sinceRaw)) { res.writeHead(400).end(JSON.stringify({ error: 'since must be a number' })); return; }
  if (untilRaw !== undefined && isNaN(untilRaw)) { res.writeHead(400).end(JSON.stringify({ error: 'until must be a number' })); return; }
  const rows = queryEventsFromDb(db, company_id, sinceRaw, untilRaw);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows));
}

export function handleEventsStream(db: DatabaseSync, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const company_id = url.searchParams.get('company_id');
  if (!company_id) { res.writeHead(400).end(JSON.stringify({ error: 'company_id required' })); return; }
  const sinceParam = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : 0;
  if (isNaN(sinceParam)) { res.writeHead(400).end(JSON.stringify({ error: 'since must be a number' })); return; }
  const since = sinceParam;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const ctrl = new AbortController();
  tailEventsFromDb(db, company_id, since, (row) => {
    res.write(`data: ${JSON.stringify(row)}\n\n`);
  }, ctrl.signal);
  req.on('close', () => ctrl.abort());
}
