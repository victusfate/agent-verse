import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as brain from '../../companyBrain.js';
import { resolveCompaniesDir } from '../../paths.js';

export function handleCompanies(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const entries = fs.readdirSync(resolveCompaniesDir(), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(entries));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([]));
  }
}

export function handleCompany(_req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  const id = pathname.replace('/companies/', '').split('/')[0]!;
  if (!id) { res.writeHead(404).end(JSON.stringify({ error: 'Company not found' })); return; }

  const companyDir = path.join(resolveCompaniesDir(), id);
  if (!fs.existsSync(companyDir)) { res.writeHead(404).end(JSON.stringify({ error: 'Company not found' })); return; }

  try {
    const context = brain.readContextFramework(id);
    const skills = brain.readSkills(id);
    const taskLogPath = path.join(companyDir, 'task_log.jsonl');
    const tasks = fs.existsSync(taskLogPath)
      ? fs.readFileSync(taskLogPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as unknown)
      : [];

    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ id, context, skills, tasks }),
    );
  } catch {
    res.writeHead(500).end(JSON.stringify({ error: 'Internal server error' }));
  }
}
