/**
 * Single source of truth for where per-venture data lives.
 * Override with COMPANIES_DIR; defaults to <repo-root>/companies regardless of CWD.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveCompaniesDir(): string {
  return process.env['COMPANIES_DIR'] ?? path.join(__dirname, '..', 'companies');
}
