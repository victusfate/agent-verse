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
