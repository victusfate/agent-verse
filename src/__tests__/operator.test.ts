import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Model } from '../llm/index.js';
import { makeTask, stubModel as modelStub } from './helpers.js';

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

const VALID_POLICY = { allowed: true, risk_tier: 'low', reason: 'safe', escalate_to_human: false };
const VALID_TOOL   = {
  deliverable: 'Here is the complete registration endpoint with full validation and error handling.',
  artifacts: ['src/routes/register.ts'],
  confidence: 0.9,
  next_actions: [],
};
// Policy that blocks without escalation — supervisor not involved
const BLOCK_POLICY = { allowed: false, risk_tier: 'high', reason: 'External mutation', escalate_to_human: false };
const LOW_CONF_TOOL = { deliverable: 'ok', artifacts: [], confidence: 0.1, next_actions: [] };

// ── Setup: temp dir for companyBrain ─────────────────────────────────────────

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-op-'));
  process.env['COMPANIES_DIR'] = path.join(tmpRoot, 'companies');
  fs.mkdirSync(path.join(tmpRoot, 'companies', 'test-co'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, 'companies', 'test-co', 'context_framework.json'),
    JSON.stringify({ mission: 'Ship it', token_budget_usd: 50 }),
  );
  fs.writeFileSync(path.join(tmpRoot, 'companies', 'test-co', 'skills.md'), '# Skills\n');
});

afterEach(() => {
  delete process.env['COMPANIES_DIR'];
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

// ── Slice 4: supervisor integration ──────────────────────────────────────────

vi.mock('../agents/supervisor.js', () => ({
  evaluate: vi.fn(),
}));

describe('operator.run — supervisor integration', () => {
  const HIGH_POLICY      = { allowed: true,  risk_tier: 'high', reason: 'External write', escalate_to_human: true };
  const BLOCKED_POLICY   = { allowed: false, risk_tier: 'high', reason: 'External mutation', escalate_to_human: true };

  // ── ops-hardening slice 1: BUG-1 ─────────────────────────────────────────
  it('completes when policy=blocked but supervisor mitigates (BUG-1)', async () => {
    const mitigatedTask = makeTask({ description: 'Read-only version', risk_tier: 'low' });
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([BLOCKED_POLICY, VALID_TOOL]));

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockResolvedValue({
      task_id: 'task-001',
      action: 'mitigate',
      reason: 'Reduced to read-only',
      estimated_cost_usd: 0.01,
      mitigated_task: mitigatedTask,
    });

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask({ risk_tier: 'high' }));
    expect(result.status).toBe('completed');
  });

  // ── ops-hardening slice 1: BUG-2 ─────────────────────────────────────────
  it('returns status failed when supervisor.evaluate throws (BUG-2)', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([HIGH_POLICY]));

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockRejectedValue(new Error('supervisor timeout'));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask({ risk_tier: 'high' }));
    expect(result.status).toBe('failed');
    expect(result.error).toContain('supervisor timeout');
  });

  it('returns status halted when supervisor halts the task', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([HIGH_POLICY]));

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockResolvedValue({
      task_id: 'task-001',
      action: 'halt',
      reason: 'Budget exhausted',
      estimated_cost_usd: 0,
    });

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask({ risk_tier: 'high' }));
    expect(result.status).toBe('halted');
  });

  it('continues with mitigated task when supervisor mitigates', async () => {
    const mitigatedTask = makeTask({ description: 'Read-only version', risk_tier: 'low' });
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([HIGH_POLICY, VALID_TOOL]));

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockResolvedValue({
      task_id: 'task-001',
      action: 'mitigate',
      reason: 'Reduced scope',
      estimated_cost_usd: 0.02,
      mitigated_task: mitigatedTask,
    });

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask({ risk_tier: 'high' }));
    expect(result.status).toBe('completed');
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
        .mockResolvedValueOnce({ text: JSON.stringify(VALID_POLICY) })
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

// ── Quality rework slice 4: safety controls ───────────────────────────────────

describe('operator.run — budget accounting (F-03)', () => {
  it('accumulates estimated LLM cost into tokens_consumed_usd', async () => {
    const usageStub: Model = {
      id: 'gpt-4o-mini', provider: 'openai',
      generate: vi.fn(async () => ({
        text: JSON.stringify(VALID_TOOL),
        usage: { inputTokens: 100_000, outputTokens: 50_000 },
      })),
    };
    // first call returns policy, second returns tool — both report usage
    vi.mocked(usageStub.generate)
      .mockResolvedValueOnce({ text: JSON.stringify(VALID_POLICY), usage: { inputTokens: 100_000, outputTokens: 50_000 } })
      .mockResolvedValueOnce({ text: JSON.stringify(VALID_TOOL), usage: { inputTokens: 100_000, outputTokens: 50_000 } });
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(usageStub);

    const { run } = await import('../agents/operator.js');
    await run(makeTask());

    const ctxPath = path.join(tmpRoot, 'companies', 'test-co', 'context_framework.json');
    const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf-8')) as Record<string, unknown>;
    expect(Number(ctx['tokens_consumed_usd'])).toBeGreaterThan(0);
  });
});

describe('operator.run — fail-closed policy (F-06)', () => {
  it('escalates to the supervisor when policyCheck itself fails', async () => {
    const policyThrows: Model = {
      id: 'stub', provider: 'openai',
      generate: vi.fn()
        .mockRejectedValueOnce(new Error('policy LLM down'))
        .mockResolvedValueOnce({ text: JSON.stringify(VALID_TOOL) }),
    };
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(policyThrows);

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockClear();
    vi.mocked(evaluate).mockResolvedValue({
      task_id: 'task-001', action: 'pass', reason: 'acceptable', estimated_cost_usd: 0.01,
    });

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(vi.mocked(evaluate)).toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('blocks the task when both policy and supervisor fail — never executes ungated', async () => {
    const policyThrows: Model = {
      id: 'stub', provider: 'openai',
      generate: vi.fn().mockRejectedValue(new Error('policy LLM down')),
    };
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(policyThrows);

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockRejectedValue(new Error('supervisor down too'));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.status).toBe('blocked');
    // the tool call must never have happened: only the policy generate call
    expect(vi.mocked(policyThrows.generate)).toHaveBeenCalledTimes(1);
  });
});

describe('operator.run — mitigation identity protection (F-08)', () => {
  it('a mitigated task cannot change task_id or company_id', async () => {
    const original = makeTask({ risk_tier: 'high' });
    const { createModel } = await import('../llm/index.js');
    const HIGH_POLICY = { allowed: true, risk_tier: 'high', reason: 'External write', escalate_to_human: true };
    vi.mocked(createModel).mockResolvedValue(modelStub([HIGH_POLICY, VALID_TOOL]));

    const { evaluate } = await import('../agents/supervisor.js');
    vi.mocked(evaluate).mockResolvedValue({
      task_id: original.task_id,
      action: 'mitigate',
      reason: 'Reduced scope',
      estimated_cost_usd: 0.02,
      mitigated_task: makeTask({ task_id: 'EVIL-ID', company_id: 'evil-co', description: 'Read-only version', risk_tier: 'low' }),
    });

    const { run } = await import('../agents/operator.js');
    const result = await run(original);
    expect(result.task_id).toBe(original.task_id);
    expect(result.company_id).toBe('test-co');
    expect(result.description).toBe('Read-only version');
  });
});

describe('operator.run — typed tool output (F-22)', () => {
  it('fails the task with a tool-execution error when output does not match ToolOutputSchema', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(modelStub([VALID_POLICY, { totally: 'wrong shape' }]));

    const { run } = await import('../agents/operator.js');
    const result = await run(makeTask());
    expect(result.status).toBe('failed');
    expect(result.error?.toLowerCase()).toContain('tool execution failed');
  });
});
