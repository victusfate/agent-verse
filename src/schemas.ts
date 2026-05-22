import { z } from 'zod';

// ── Venture payload (Idea-Agent → CEO-Agent) ──────────────────────────────────

export const VenturePayloadSchema = z.object({
  company_name: z.string().describe('Kebab-case identifier, e.g. pdf-to-podcast-api'),
  core_value_proposition: z.string(),
  target_audience: z.string(),
  initial_capability_requirements: z.array(z.string()),
  estimated_token_cost_ceiling_usd: z.number(),
});
export type VenturePayload = z.infer<typeof VenturePayloadSchema>;

// ── Operator task ─────────────────────────────────────────────────────────────

export const OperatorTaskSchema = z.object({
  task_id: z.string().default(() => crypto.randomUUID()),
  company_id: z.string(),
  role: z.enum(['product', 'engineering', 'customer-success']),
  description: z.string(),
  risk_tier: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'blocked']).default('pending'),
  result: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type OperatorTask = z.infer<typeof OperatorTaskSchema>;

// ── Policy decision (Layer 2) ─────────────────────────────────────────────────

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  risk_tier: z.enum(['low', 'medium', 'high', 'critical']),
  reason: z.string(),
  escalate_to_human: z.boolean(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// ── Quality gate result (Layer 4) ─────────────────────────────────────────────

export const QualityGateResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
  validated_output: z.string().nullable(),
});
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

// ── Telemetry entry (Layer 5) ─────────────────────────────────────────────────

export const TelemetryEntrySchema = z.object({
  company_id: z.string(),
  task_id: z.string(),
  agent_role: z.string(),
  layer: z.string(),
  data: z.record(z.string(), z.unknown()),
  success: z.boolean(),
  error: z.string().nullable().default(null),
  ts: z.string().default(() => new Date().toISOString()),
});
export type TelemetryEntry = z.infer<typeof TelemetryEntrySchema>;

// ── Monitor report (Monitor-Agent output) ────────────────────────────────────

export const MonitorReportSchema = z.object({
  company_id: z.string(),
  cycle: z.number(),
  friction_points: z.array(z.record(z.string(), z.unknown())),
  diagnosis: z.string(),
  mitigation_type: z.enum(['code_fix', 'data_optimization', 'skills_update', 'none']),
  skills_update: z.string().nullable().default(null),
  iteration_complete: z.boolean(),
});
export type MonitorReport = z.infer<typeof MonitorReportSchema>;

// ── CEO brain init ────────────────────────────────────────────────────────────

export const BrainInitSchema = z.object({
  context_framework: z.record(z.string(), z.unknown()),
  skills_md: z.string(),
  operator_tasks: z.array(z.object({
    role: z.enum(['product', 'engineering', 'customer-success']),
    description: z.string(),
    risk_tier: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  })),
});
export type BrainInit = z.infer<typeof BrainInitSchema>;
