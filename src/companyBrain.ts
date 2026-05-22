/**
 * Company Brain — per-venture persistent knowledge.
 * Manages context_framework.json and skills.md for each company instance.
 * These files are the "durable asset" of each venture; source code is ephemeral.
 */
import fs from 'node:fs';
import path from 'node:path';

const COMPANIES_DIR = 'companies';

function ventureDir(companyId: string): string {
  return path.join(COMPANIES_DIR, companyId);
}

function ensureDir(companyId: string): void {
  fs.mkdirSync(ventureDir(companyId), { recursive: true });
}

export function writeContextFramework(companyId: string, context: unknown): void {
  ensureDir(companyId);
  fs.writeFileSync(
    path.join(ventureDir(companyId), 'context_framework.json'),
    JSON.stringify(context, null, 2),
  );
}

export function readContextFramework(companyId: string): Record<string, unknown> {
  const p = path.join(ventureDir(companyId), 'context_framework.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>;
}

export function writeSkills(companyId: string, content: string): void {
  ensureDir(companyId);
  fs.writeFileSync(path.join(ventureDir(companyId), 'skills.md'), content);
}

export function readSkills(companyId: string): string {
  const p = path.join(ventureDir(companyId), 'skills.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf-8');
}

export function appendTaskLog(companyId: string, taskId: string, data: unknown): void {
  ensureDir(companyId);
  const p = path.join(ventureDir(companyId), 'task_log.jsonl');
  fs.appendFileSync(p, JSON.stringify({ taskId, ...(data as object) }) + '\n');
}
