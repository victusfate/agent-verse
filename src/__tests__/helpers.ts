/**
 * Shared test helpers — one canonical task fixture, model stub, and http GET.
 * vi.mock blocks stay per-file (vitest hoisting requires it).
 */
import { vi } from 'vitest';
import http from 'node:http';
import type { Model } from '../llm/index.js';
import type { OperatorTask } from '../schemas.js';

export function makeTask(overrides: Partial<OperatorTask> = {}): OperatorTask {
  return {
    task_id: crypto.randomUUID(),
    company_id: 'test-co',
    role: 'engineering',
    description: 'Write an API endpoint for user registration',
    risk_tier: 'low',
    status: 'pending',
    result: null,
    error: null,
    ...overrides,
  };
}

/** A Model that cycles through canned JSON responses. */
export function stubModel(canned: Record<string, unknown>[]): Model {
  let call = 0;
  return {
    id: 'stub',
    provider: 'openai',
    generate: vi.fn(async () => ({ text: JSON.stringify(canned[call++ % canned.length]) })),
  };
}

export function get(
  port: number,
  urlPath: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}
