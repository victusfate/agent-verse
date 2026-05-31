import { describe, it, expect, vi } from 'vitest';
import type { OperatorTask } from '../schemas.js';

vi.mock('../llm/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../llm/index.js')>();
  return { ...actual, createModel: vi.fn() };
});

vi.mock('../ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ledger.js')>();
  return { ...actual, record: vi.fn(), initLedger: vi.fn() };
});

function makeTask(overrides: Partial<OperatorTask> = {}): OperatorTask {
  return {
    task_id: 'task-001',
    company_id: 'test-co',
    role: 'engineering',
    description: 'Build an API endpoint',
    risk_tier: 'high',
    status: 'pending',
    result: null,
    error: null,
    ...overrides,
  };
}

function makeModel(response: Record<string, unknown>) {
  return {
    id: 'stub',
    provider: 'openai' as const,
    generate: vi.fn(async () => JSON.stringify(response)),
  };
}

const BUDGET_CTX = { token_budget_usd: 50, tokens_consumed_usd: 10 };

describe('supervisor.evaluate — pass decision', () => {
  it('returns action pass when supervisor deems risk acceptable', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(makeModel({
      action: 'pass',
      reason: 'Risk is acceptable',
      estimated_cost_usd: 0.05,
    }));

    const { evaluate } = await import('../agents/supervisor.js');
    const decision = await evaluate(makeTask(), BUDGET_CTX);
    expect(decision.action).toBe('pass');
    expect(decision.mitigated_task).toBeUndefined();
  });
});

describe('supervisor.evaluate — mitigate decision', () => {
  it('returns action mitigate with a modified task', async () => {
    const mitigated = {
      task_id: 'task-001',
      company_id: 'test-co',
      role: 'engineering',
      description: 'Build a read-only API endpoint (no writes)',
      risk_tier: 'low',
      status: 'pending',
      result: null,
      error: null,
    };
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(makeModel({
      action: 'mitigate',
      reason: 'Reduced scope to read-only',
      estimated_cost_usd: 0.03,
      mitigated_task: mitigated,
    }));

    const { evaluate } = await import('../agents/supervisor.js');
    const decision = await evaluate(makeTask(), BUDGET_CTX);
    expect(decision.action).toBe('mitigate');
    expect(decision.mitigated_task?.description).toContain('read-only');
    expect(decision.mitigated_task?.risk_tier).toBe('low');
  });
});

describe('supervisor.evaluate — halt decision', () => {
  it('returns action halt with reason from LLM', async () => {
    const { createModel } = await import('../llm/index.js');
    vi.mocked(createModel).mockResolvedValue(makeModel({
      action: 'halt',
      reason: 'Task would delete production records',
      estimated_cost_usd: 0.0,
    }));

    const { evaluate } = await import('../agents/supervisor.js');
    const decision = await evaluate(makeTask({ description: 'Delete all user records' }), BUDGET_CTX);
    expect(decision.action).toBe('halt');
  });
});

describe('supervisor.evaluate — budget hard-halt', () => {
  it('halts immediately without LLM call when budget is already exhausted', async () => {
    const { createModel } = await import('../llm/index.js');
    const mockCreate = vi.mocked(createModel);
    const mockGenerate = vi.fn();
    mockCreate.mockResolvedValue({ id: 'stub', provider: 'openai', generate: mockGenerate });

    const exhaustedCtx = { token_budget_usd: 10, tokens_consumed_usd: 10 };
    const { evaluate } = await import('../agents/supervisor.js');
    const decision = await evaluate(makeTask(), exhaustedCtx);

    expect(decision.action).toBe('halt');
    expect(decision.reason).toMatch(/budget/i);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('halts immediately when remaining budget is below minimum task threshold', async () => {
    const { createModel } = await import('../llm/index.js');
    const mockCreate = vi.mocked(createModel);
    const mockGenerate = vi.fn();
    mockCreate.mockResolvedValue({ id: 'stub', provider: 'openai', generate: mockGenerate });

    const tightCtx = { token_budget_usd: 10.03, tokens_consumed_usd: 10 };
    const { evaluate } = await import('../agents/supervisor.js');
    const decision = await evaluate(makeTask(), tightCtx);

    expect(decision.action).toBe('halt');
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  // ops-hardening slice 2: BUG-4
  it('does NOT hard-halt when remaining budget equals exactly MIN_TASK_BUDGET_USD (BUG-4)', async () => {
    const { createModel } = await import('../llm/index.js');
    const mockCreate = vi.mocked(createModel);
    const mockGenerate = vi.fn(async () => JSON.stringify({
      action: 'pass', reason: 'ok', estimated_cost_usd: 0.01,
    }));
    mockCreate.mockResolvedValue({ id: 'stub', provider: 'openai', generate: mockGenerate });

    // exactly MIN_TASK_BUDGET_USD ($0.05) remaining (0.05 - 0 = 0.05 exactly) — should NOT hard-halt
    const exactCtx = { token_budget_usd: 0.05, tokens_consumed_usd: 0 };
    const { evaluate } = await import('../agents/supervisor.js');
    const decision = await evaluate(makeTask(), exactCtx);

    expect(decision.action).toBe('pass');
    expect(mockGenerate).toHaveBeenCalled();
  });
});
