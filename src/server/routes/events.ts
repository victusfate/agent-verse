import type http from 'node:http';
import type { Ledger } from '../../ledger.js';

const JSON_CT = { 'Content-Type': 'application/json' };

interface EventQuery {
  company_id: string;
  since?: number;
  until?: number;
}

/** Shared query validation for both events endpoints. Writes the 400 itself and returns null on failure. */
function parseEventQuery(req: http.IncomingMessage, res: http.ServerResponse): EventQuery | null {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const company_id = url.searchParams.get('company_id');
  if (!company_id) {
    res.writeHead(400, JSON_CT).end(JSON.stringify({ error: 'company_id required' }));
    return null;
  }
  const query: EventQuery = { company_id };
  for (const name of ['since', 'until'] as const) {
    const value = url.searchParams.get(name);
    if (value === null) continue;
    if (value.trim() === '' || isNaN(Number(value))) {
      res.writeHead(400, JSON_CT).end(JSON.stringify({ error: `${name} must be a number` }));
      return null;
    }
    query[name] = Number(value);
  }
  return query;
}

export function handleEventsRange(ledger: Ledger, req: http.IncomingMessage, res: http.ServerResponse): void {
  const query = parseEventQuery(req, res);
  if (!query) return;
  const rows = ledger.queryEvents(query.company_id, query.since, query.until);
  res.writeHead(200, JSON_CT).end(JSON.stringify(rows));
}

const HEARTBEAT_MS = 30_000;

export function handleEventsStream(ledger: Ledger, req: http.IncomingMessage, res: http.ServerResponse): void {
  const query = parseEventQuery(req, res);
  if (!query) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const ctrl = new AbortController();
  // SSE comment heartbeat keeps idle streams alive through proxies
  const heartbeat = setInterval(() => res.write(':hb\n\n'), HEARTBEAT_MS);

  ledger.tailEvents(query.company_id, query.since ?? 0, (row) => {
    res.write(`data: ${JSON.stringify(row)}\n\n`);
  }, ctrl.signal);

  req.on('close', () => {
    ctrl.abort();
    clearInterval(heartbeat);
    res.end();
  });
}
