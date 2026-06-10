import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Model } from '../llm/index.js';
import { makeTask } from './helpers.js';

vi.mock('../llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/index.js')>();
  return { ...actual, createModel: vi.fn() };
});

vi.mock('../ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ledger.js')>();
  return { ...actual, record: vi.fn(), queryFailures: vi.fn(() => []) };
});

function sdkStub(json: Record<string, unknown>): Model {
  return {
    id: 'claude-sonnet-4-6',
    provider: 'sdk',
    generate: vi.fn(async () => ({ text: JSON.stringify(json), costUsd: 0.05 })),
  };
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-sess-'));
  process.env['COMPANIES_DIR'] = path.join(tmpRoot, 'companies');
  fs.mkdirSync(path.join(tmpRoot, 'companies', 'test-co'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'companies', 'test-co', 'skills.md'), '# Skills\n');
});

afterEach(() => {
  delete process.env['COMPANIES_DIR'];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('sdk-runtime session contexts for idea/ceo/monitor', () => {
  it('idea agent surveys the companies root read-only', async () => {
    const model = sdkStub({
      company_name: 'pdf-ocr-api',
      core_value_proposition: 'OCR as a service',
      target_audience: 'devs',
      initial_capability_requirements: ['ocr'],
      estimated_token_cost_ceiling_usd: 25,
    });
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(model);

    const { run } = await import('../agents/idea.js');
    await run('seed idea');

    const [, , options] = vi.mocked(model.generate).mock.calls[0]!;
    expect(options?.session).toMatchObject({
      cwd: path.join(tmpRoot, 'companies'),
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 4,
    });
  });

  it('ceo agent gets Write at the companies root to scaffold the company dir', async () => {
    const model = sdkStub({
      context_framework: { mission: 'Ship OCR' },
      skills_md: '# Skills\n- ship',
      operator_tasks: [
        { role: 'product', description: 'spec it', risk_tier: 'low' },
      ],
    });
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(model);

    const { run } = await import('../agents/ceo.js');
    await run({
      company_name: 'test-co',
      core_value_proposition: 'x',
      target_audience: 'y',
      initial_capability_requirements: [],
      estimated_token_cost_ceiling_usd: 25,
    });

    const [, , options] = vi.mocked(model.generate).mock.calls[0]!;
    expect(options?.session).toMatchObject({
      cwd: path.join(tmpRoot, 'companies'),
      allowedTools: ['Read', 'Write', 'Glob'],
      maxTurns: 4,
    });
  });

  it('monitor agent reads the company dir read-only', async () => {
    const model = sdkStub({
      friction_summary: 'none',
      mitigation_type: 'none',
      skills_update: null,
      iteration_complete: true,
    });
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(model);

    const { run } = await import('../agents/monitor.js');
    await run('test-co', [makeTask({ status: 'completed' })], 1);

    const [, , options] = vi.mocked(model.generate).mock.calls[0]!;
    expect(options?.session).toMatchObject({
      cwd: path.join(tmpRoot, 'companies', 'test-co'),
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 4,
    });
  });
});
