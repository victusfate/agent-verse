import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  SupervisorDecisionSchema,
  HardHaltSchema,
  OperatorTaskSchema,
} from '../schemas.js';

describe('SupervisorDecisionSchema', () => {
  const base = {
    task_id: 'abc-123',
    action: 'pass' as const,
    reason: 'Risk acceptable after review',
    estimated_cost_usd: 0.02,
  };

  it('accepts a pass decision', () => {
    const result = SupervisorDecisionSchema.parse(base);
    expect(result.action).toBe('pass');
    expect(result.mitigated_task).toBeUndefined();
  });

  it('accepts a halt decision', () => {
    const result = SupervisorDecisionSchema.parse({ ...base, action: 'halt' });
    expect(result.action).toBe('halt');
  });

  it('accepts a mitigate decision with mitigated_task', () => {
    const mitigated = {
      task_id: 'abc-123',
      company_id: 'test-co',
      role: 'engineering' as const,
      description: 'Reduced scope task',
      risk_tier: 'low' as const,
      status: 'pending' as const,
      result: null,
      error: null,
    };
    const result = SupervisorDecisionSchema.parse({ ...base, action: 'mitigate', mitigated_task: mitigated });
    expect(result.action).toBe('mitigate');
    expect(result.mitigated_task).toBeDefined();
  });

  it('rejects an unknown action', () => {
    expect(() => SupervisorDecisionSchema.parse({ ...base, action: 'escalate' })).toThrow(ZodError);
  });

  it('rejects missing estimated_cost_usd', () => {
    const { estimated_cost_usd: _, ...rest } = base;
    expect(() => SupervisorDecisionSchema.parse(rest)).toThrow(ZodError);
  });
});

describe('HardHaltSchema', () => {
  it('accepts a budget_exceeded halt', () => {
    const result = HardHaltSchema.parse({
      company_id: 'test-co',
      task_id: 'abc-123',
      reason: 'budget_exceeded',
      detail: 'Would exceed $50 ceiling',
    });
    expect(result.reason).toBe('budget_exceeded');
  });

  it('accepts a destructive_action halt', () => {
    const result = HardHaltSchema.parse({
      company_id: 'test-co',
      task_id: 'abc-123',
      reason: 'destructive_action',
      detail: 'Task would delete production data',
    });
    expect(result.reason).toBe('destructive_action');
  });

  it('rejects an unknown reason', () => {
    expect(() => HardHaltSchema.parse({
      company_id: 'test-co', task_id: 'abc-123',
      reason: 'too_expensive', detail: 'x',
    })).toThrow(ZodError);
  });
});

describe('OperatorTaskSchema halted status', () => {
  it('accepts halted status', () => {
    const result = OperatorTaskSchema.parse({
      company_id: 'test-co',
      role: 'engineering',
      description: 'Some task',
      status: 'halted',
    });
    expect(result.status).toBe('halted');
  });
});
