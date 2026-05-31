import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const COMPANIES_DIR = path.join(process.cwd(), 'companies');

export function handleCompanies(_req: http.IncomingMessage, res: http.ServerResponse): void {
  try {
    const entries = fs.readdirSync(COMPANIES_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(entries));
  } catch {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([]));
  }
}

export function handleCompany(_req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  const id = pathname.replace('/companies/', '').split('/')[0]!;
  const companyDir = path.join(COMPANIES_DIR, id);

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
    res.writeHead(404).end(JSON.stringify({ error: 'Company not found' }));
  }
}
