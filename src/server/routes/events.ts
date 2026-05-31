import type http from 'node:http';
import { DatabaseSync } from 'node:sqlite';

type RawRow = { id: number; ts: string; company_id: string; event_type: string; agent_type: string | null; payload: string };

function queryEvents(db: DatabaseSync, company_id: string, since?: number, until?: number): object[] {
  let sql = 'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ?';
  const params: unknown[] = [company_id];
  if (since !== undefined) { sql += ' AND id > ?'; params.push(since); }
  if (until !== undefined) { sql += ' AND id <= ?'; params.push(until); }
  sql += ' ORDER BY id ASC';
  return (db.prepare(sql).all(...params) as RawRow[]).map(r => ({ ...r, payload: JSON.parse(r.payload) }));
}

export function handleEventsRange(db: DatabaseSync, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const company_id = url.searchParams.get('company_id');
  if (!company_id) { res.writeHead(400).end(JSON.stringify({ error: 'company_id required' })); return; }
  const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : undefined;
  const until = url.searchParams.has('until') ? Number(url.searchParams.get('until')) : undefined;
  const rows = queryEvents(db, company_id, since, until);
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows));
}

export function handleEventsStream(db: DatabaseSync, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const company_id = url.searchParams.get('company_id');
  if (!company_id) { res.writeHead(400).end(JSON.stringify({ error: 'company_id required' })); return; }
  const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : 0;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let lastId = since;
  let aborted = false;

  const poll = () => {
    if (aborted) return;
    try {
      const rows = (db.prepare(
        'SELECT id, ts, company_id, event_type, agent_type, payload FROM events WHERE company_id = ? AND id > ? ORDER BY id ASC'
      ).all(company_id, lastId) as RawRow[]).map(r => ({ ...r, payload: JSON.parse(r.payload) }));

      for (const row of rows) {
        lastId = (row as { id: number }).id;
        res.write(`data: ${JSON.stringify(row)}\n\n`);
      }
    } catch { /* db may be closing */ }
    if (!aborted) setTimeout(poll, 500);
  };

  poll();
  req.on('close', () => { aborted = true; });
}
