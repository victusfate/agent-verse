import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  VenturePayloadSchema,
  OperatorTaskSchema,
  PolicyDecisionSchema,
  QualityGateResultSchema,
  MonitorReportSchema,
} from '../schemas.js';

// ── VenturePayloadSchema ──────────────────────────────────────────────────────

describe('VenturePayloadSchema', () => {
  const valid = {
    company_name: 'pdf-ocr-api',
    core_value_proposition: 'Extract text from PDFs via API',
    target_audience: 'Developer teams',
    initial_capability_requirements: ['pdf-parse', 'openai-vision'],
    estimated_token_cost_ceiling_usd: 25,
  };

  it('accepts a valid payload', () => {
    const result = VenturePayloadSchema.parse(valid);
    expect(result.company_name).toBe('pdf-ocr-api');
    expect(result.initial_capability_requirements).toHaveLength(2);
  });

  it('rejects missing required field', () => {
    const { company_name: _, ...rest } = valid;
    expect(() => VenturePayloadSchema.parse(rest)).toThrow(ZodError);
  });

  it('rejects wrong type for estimated_token_cost_ceiling_usd', () => {
    expect(() => VenturePayloadSchema.parse({ ...valid, estimated_token_cost_ceiling_usd: 'fifty' })).toThrow(ZodError);
  });
});

// ── OperatorTaskSchema ────────────────────────────────────────────────────────

describe('OperatorTaskSchema', () => {
  const minimal = {
    company_id: 'test-co',
    role: 'engineering',
    description: 'Build the API endpoints',
  };

  it('applies default status of pending', () => {
    expect(OperatorTaskSchema.parse(minimal).status).toBe('pending');
  });

  it('applies default result and error of null', () => {
    const result = OperatorTaskSchema.parse(minimal);
    expect(result.result).toBeNull();
    expect(result.error).toBeNull();
  });

  it('generates a uuid for task_id when not provided', () => {
    const result = OperatorTaskSchema.parse(minimal);
    expect(result.task_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('rejects an invalid role enum value', () => {
    expect(() => OperatorTaskSchema.parse({ ...minimal, role: 'marketing' })).toThrow(ZodError);
  });

  it('accepts all valid role values', () => {
    for (const role of ['product', 'engineering', 'customer-success'] as const) {
      expect(() => OperatorTaskSchema.parse({ ...minimal, role })).not.toThrow();
    }
  });
});

// ── PolicyDecisionSchema ──────────────────────────────────────────────────────

describe('PolicyDecisionSchema', () => {
  it('parses a valid policy decision', () => {
    const result = PolicyDecisionSchema.parse({
      allowed: true,
      risk_tier: 'low',
      reason: 'Read-only task',
      escalate_to_human: false,
    });
    expect(result.allowed).toBe(true);
    expect(result.risk_tier).toBe('low');
  });

  it('rejects an invalid risk_tier', () => {
    expect(() => PolicyDecisionSchema.parse({
      allowed: true, risk_tier: 'extreme', reason: 'x', escalate_to_human: false,
    })).toThrow(ZodError);
  });
});

// ── QualityGateResultSchema ───────────────────────────────────────────────────

describe('QualityGateResultSchema', () => {
  it('accepts passed gate with null validated_output when failed', () => {
    const result = QualityGateResultSchema.parse({
      passed: false,
      issues: ['too short'],
      validated_output: null,
    });
    expect(result.passed).toBe(false);
    expect(result.issues).toContain('too short');
  });
});

// ── MonitorReportSchema ───────────────────────────────────────────────────────

describe('MonitorReportSchema', () => {
  it('rejects an invalid mitigation_type', () => {
    expect(() => MonitorReportSchema.parse({
      company_id: 'x', cycle: 1, friction_points: [],
      diagnosis: 'ok', mitigation_type: 'rewrite_everything',
      iteration_complete: false,
    })).toThrow(ZodError);
  });

  it('defaults skills_update to null', () => {
    const result = MonitorReportSchema.parse({
      company_id: 'x', cycle: 1, friction_points: [],
      diagnosis: 'ok', mitigation_type: 'none',
      iteration_complete: true,
    });
    expect(result.skills_update).toBeNull();
  });
});
