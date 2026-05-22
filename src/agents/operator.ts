/**
 * Phase 3 — Operator-Agent (5-layer recursive execution loop)
 *
 * Layer 1 — SENSOR:       Ingest task from shared state.
 * Layer 2 — POLICY:       Evaluate risk; escalate high/critical to human gate.
 * Layer 3 — TOOL:         Execute deterministic work via LLM completion.
 * Layer 4 — QUALITY GATE: Validate output structure and content.
 * Layer 5 — LEARNING:     Package the full invocation stack as telemetry.
 */
import {
  PolicyDecisionSchema,
  QualityGateResultSchema,
  TelemetryEntrySchema,
  type OperatorTask,
  type PolicyDecision,
  type QualityGateResult,
  type TelemetryEntry,
} from '../schemas.js';
import { withJsonSchema, parseModelJson, createModel } from '../llm/index.js';
import * as brain from '../companyBrain.js';
import { record } from '../ledger.js';

// ── Schema hints embedded in prompts ─────────────────────────────────────────

const EXECUTE_SCHEMA = `{
  "deliverable": "string (the complete concrete output)",
  "artifacts": ["list of artifacts produced: file paths, schema names, URLs, etc."],
  "confidence": 0.9,
  "next_actions": ["recommended follow-up actions for other agents"]
}`;

const POLICY_SCHEMA = `{
  "allowed": true,
  "risk_tier": "low|medium|high|critical",
  "reason": "string",
  "escalate_to_human": false
}`;

// ── Layer 2: Policy ───────────────────────────────────────────────────────────

async function policyCheck(task: OperatorTask, budgetRemaining: number): Promise<PolicyDecision> {
  const model = await createModel();
  const system = withJsonSchema(
    `You are a Policy-Layer agent. Evaluate the task against company constraints.
Rules:
- Financial mutations above $100 → CRITICAL
- External API writes or mutations → HIGH
- Read-only or generative tasks → LOW
- Escalate to human if risk is HIGH or CRITICAL
- Remaining token budget: $${budgetRemaining.toFixed(2)} USD`,
    POLICY_SCHEMA,
  );
  const raw = await model.generate(system, `Evaluate this task:\n${task.description}`, {
    jsonMode: true,
    maxTokens: 512,
  });
  return PolicyDecisionSchema.parse(parseModelJson(raw));
}

// ── Layer 3: Tool execution ───────────────────────────────────────────────────

const ROLE_CONTEXT: Record<string, string> = {
  product: 'You are the Product-Agent. Produce product specs, user stories, and go-to-market copy.',
  engineering: 'You are the Engineering-Agent. Write code, API schemas, database queries, and technical specs.',
  'customer-success': 'You are the Customer-Success-Agent. Write onboarding flows, email sequences, and support playbooks.',
};

async function executeTool(
  task: OperatorTask,
  skills: string,
  context: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const model = await createModel();
  const mission = typeof context['mission'] === 'string' ? context['mission'] : '';
  const system = withJsonSchema(
    `${ROLE_CONTEXT[task.role] ?? 'You are an Operator-Agent.'}

Company mission: ${mission}

Company skills:
${skills.slice(0, 2000)}`,
    EXECUTE_SCHEMA,
  );
  const raw = await model.generate(system, `Execute this task:\n\n${task.description}`, {
    jsonMode: true,
    maxTokens: 2048,
  });
  return parseModelJson(raw) as Record<string, unknown>;
}

// ── Layer 4: Quality gate ─────────────────────────────────────────────────────

function qualityGate(toolOutput: Record<string, unknown>): QualityGateResult {
  const issues: string[] = [];
  const deliverable = String(toolOutput['deliverable'] ?? '');
  const confidence = Number(toolOutput['confidence'] ?? 0);

  if (deliverable.length < 20) issues.push('Deliverable is empty or too short');
  if (confidence < 0.3) issues.push(`Low confidence score: ${confidence.toFixed(2)}`);
  if (!Array.isArray(toolOutput['artifacts']) || (toolOutput['artifacts'] as unknown[]).length === 0) {
    issues.push('No artifacts listed');
  }

  return QualityGateResultSchema.parse({
    passed: issues.length === 0,
    issues,
    validated_output: issues.length === 0 ? deliverable : null,
  });
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function run(task: OperatorTask): Promise<OperatorTask> {
  const stack: TelemetryEntry[] = [];

  const telem = (layer: string, data: Record<string, unknown>, success: boolean, error?: string) => {
    const entry = TelemetryEntrySchema.parse({
      company_id: task.company_id,
      task_id: task.task_id,
      agent_role: task.role,
      layer,
      data,
      success,
      error: error ?? null,
    });
    stack.push(entry);
    record(task.company_id, 'telemetry', entry, `operator.${task.role}`);
  };

  console.log(`\n[Operator:${task.role}] Starting task ${task.task_id.slice(0, 8)}...`);

  // ── L1: Sensor ───────────────────────────────────────────────────────────
  task = { ...task, status: 'in_progress' };
  record(task.company_id, 'task.started', { task_id: task.task_id }, `operator.${task.role}`);
  telem('sensor', { task }, true);
  console.log(`[Operator:${task.role}] L1-Sensor ✓`);

  // ── L2: Policy ───────────────────────────────────────────────────────────
  const ctx = brain.readContextFramework(task.company_id);
  const budget = Number(ctx['token_budget_usd'] ?? 50) - Number(ctx['tokens_consumed_usd'] ?? 0);
  let policy: PolicyDecision;
  try {
    policy = await policyCheck(task, budget);
    telem('policy', policy, policy.allowed, policy.allowed ? undefined : 'policy blocked');
    console.log(`[Operator:${task.role}] L2-Policy ✓  risk=${policy.risk_tier} allowed=${policy.allowed}`);

    if (policy.escalate_to_human) {
      console.log(`[Operator:${task.role}] ⚠ Human escalation required (risk=${policy.risk_tier})`);
      record(task.company_id, 'human.escalation_required', { task_id: task.task_id, reason: policy.reason }, `operator.${task.role}`);
    }

    if (!policy.allowed) {
      return { ...task, status: 'blocked', error: `Policy blocked: ${policy.reason}` };
    }
  } catch (err) {
    const msg = String(err);
    telem('policy', {}, false, msg);
    console.log(`[Operator:${task.role}] L2-Policy ✗  ${msg}`);
    // Non-fatal — continue with execution
  }

  // ── L3: Tool ─────────────────────────────────────────────────────────────
  const skills = brain.readSkills(task.company_id);
  let toolOutput: Record<string, unknown>;
  try {
    toolOutput = await executeTool(task, skills, ctx);
    telem('tool', toolOutput, Boolean(toolOutput['deliverable']));
    console.log(`[Operator:${task.role}] L3-Tool    ✓  confidence=${Number(toolOutput['confidence'] ?? 0).toFixed(2)}`);
  } catch (err) {
    const msg = String(err);
    telem('tool', {}, false, msg);
    telem('learning', { failed: true }, false, msg);
    console.log(`[Operator:${task.role}] L3-Tool    ✗  ${msg}`);
    return { ...task, status: 'failed', error: `Tool execution failed: ${msg}` };
  }

  // ── L4: Quality gate ─────────────────────────────────────────────────────
  const qg = qualityGate(toolOutput);
  telem('quality_gate', { passed: qg.passed, issues: qg.issues }, qg.passed,
    qg.passed ? undefined : qg.issues.join('; '));

  if (!qg.passed) {
    console.log(`[Operator:${task.role}] L4-QGate   ✗  ${qg.issues.join(', ')}`);
    telem('learning', { qg_failed: true, issues: qg.issues }, false);
    return { ...task, status: 'failed', error: `Quality gate: ${qg.issues.join('; ')}` };
  }
  console.log(`[Operator:${task.role}] L4-QGate   ✓`);

  // ── L5: Learning ──────────────────────────────────────────────────────────
  const completed: OperatorTask = { ...task, status: 'completed', result: qg.validated_output };
  telem('learning', {
    layers_executed: 5,
    confidence: toolOutput['confidence'],
    artifacts: toolOutput['artifacts'],
    next_actions: toolOutput['next_actions'],
  }, true);

  brain.appendTaskLog(task.company_id, task.task_id, {
    task: completed,
    tool_output: toolOutput,
    telemetry_count: stack.length,
  });
  record(task.company_id, 'task.completed', { task_id: task.task_id, role: task.role }, `operator.${task.role}`);
  console.log(`[Operator:${task.role}] L5-Learn   ✓  → task COMPLETED`);
  return completed;
}
