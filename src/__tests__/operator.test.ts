import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Model } from '../llm/index.js';
import type { OperatorTask } from '../schemas.js';

// Mock createModel at top level so vitest's hoist can handle it correctly
vi.mock('../llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/index.js')>();
  return { ...actual, createModel: vi.fn() };
});

// Mock ledger.record so operator tests don't depend on real SQLite singleton
vi.mock('../ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ledger.js')>();
  return { ...actual, record: vi.fn(), initLedger: vi.fn() };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<OperatorTask> = {}): OperatorTask {
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

function modelStub(canned: Record<string, unknown>[]): Model {
  let call = 0;
  return {
    id: 'stub', provider: 'openai',
    generate: vi.fn(async () => JSON.stringify(canned[call++ % canned.length])),
  };
}

const VALID_POLICY = { allowed: true, risk_tier: 'low', reason: 'safe', escalate_to_human: false };
const VALID_TOOL   = {
  deliverable: 'Here is the complete registration endpoint with full validation and error handling.',
  artifacts: ['src/routes/register.ts'],
  confidence: 0.9,
  next_actions: [],
};
const BLOCK_POLICY = { allowed: false, risk_tier: 'high', reason: 'External mutation', escalate_to_human: true };
const LOW_CONF_TOOL = { deliverable: 'ok', artifacts: [], confidence: 0.1, next_actions: [] };

// ── Setup: temp dir for companyBrain ─────────────────────────────────────────

let tmpRoot: string;
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-op-'));
  process.chdir(tmpRoot);
  fs.mkdirSync(path.join(tmpRoot, 'companies', 'test-co'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, 'companies', 'test-co', 'context_framework.json'),
    JSON.stringify({ mission: 'Ship it', token_budget_usd: 50 }),
  );
  fs.writeFileSync(path.join(tmpRoot, 'companies', 'test-co', 'skills.md'), '# Skills\n');
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── Slice 6: happy path ───────────────────────────────────────────────────────

describe('operator.run — happy path (slice 6)', () => {
  it('returns status completed when all 5 layers succeed', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([VALID_POLICY, VALID_TOOL]));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.status).toBe('completed');
  });

  it('returns a non-null result string on success', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([VALID_POLICY, VALID_TOOL]));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.result).toBeTruthy();
  });
});

// ── Slice 7: failure paths ────────────────────────────────────────────────────

describe('operator.run — failure paths (slice 7)', () => {
  it('returns status blocked when policy denies the task', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([BLOCK_POLICY]));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.status).toBe('blocked');
    expect(result.error).toContain('Policy blocked');
  });

  it('returns status failed with error message when tool throws', async () => {
    const throwingModel: Model = {
      id: 'stub', provider: 'openai',
      generate: vi.fn()
        .mockResolvedValueOnce(JSON.stringify(VALID_POLICY))
        .mockRejectedValueOnce(new Error('network timeout')),
    };
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(throwingModel);

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('network timeout');
  });

  it('returns status failed when quality gate rejects a low-confidence deliverable', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([VALID_POLICY, LOW_CONF_TOOL]));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.status).toBe('failed');
    expect(result.error?.toLowerCase()).toContain('quality gate');
  });
});
