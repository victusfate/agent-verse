import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function companiesDir(): string {
  return path.join(process.cwd(), 'companies');
}

export function handleCompanies(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const entries = fs.readdirSync(companiesDir(), { withFileTypes: true })
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
  const companyDir = path.join(companiesDir(), id);

  if (!fs.existsSync(companyDir)) { res.writeHead(404).end(JSON.stringify({ error: 'Company not found' })); return; }

  try {
    const contextPath = path.join(companyDir, 'context_framework.json');
    const skillsPath = path.join(companyDir, 'skills.md');
    const taskLogPath = path.join(companyDir, 'task_log.jsonl');

    const context = fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : {};
    const skills = fs.existsSync(skillsPath) ? fs.readFileSync(skillsPath, 'utf8') : '';
    const tasks = fs.existsSync(taskLogPath)
      ? fs.readFileSync(taskLogPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      : [];

    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ id, context, skills, task_count: tasks.length, tasks }),
    );
  } catch {
    res.writeHead(500).end(JSON.stringify({ error: 'Internal server error' }));
  }
}
