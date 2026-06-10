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
  ToolOutputSchema,
  type OperatorTask,
  type PolicyDecision,
  type QualityGateResult,
  type SupervisorDecision,
  type TelemetryEntry,
  type ToolOutput,
} from '../schemas.js';
import path from 'node:path';
import { withJsonSchema, parseModelJson, createModel, type LlmRequestOptions, type SessionContext } from '../llm/index.js';
import { estimateCostUsd } from '../llm/pricing.js';
import { SdkSessionError } from '../llm/sdk.js';
import { resolveCompaniesDir } from '../paths.js';
import * as brain from '../companyBrain.js';
import { record } from '../ledger.js';
import * as supervisor from './supervisor.js';
import { createToolGate } from './toolGate.js';

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

/** Generate via the configured model and charge the estimated cost to the venture. */
async function chargedGenerate(
  companyId: string,
  system: string,
  prompt: string,
  options: LlmRequestOptions,
): Promise<string> {
  const model = await createModel();
  const { text, usage, costUsd } = await model.generate(system, prompt, options);
  // Actual session cost (sdk runtime) beats the token-based estimate.
  brain.addConsumedCost(companyId, costUsd ?? estimateCostUsd(model, usage, text));
  return text;
}

const OPERATOR_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'];
const OPERATOR_MAX_TURNS = 10;

/** Session scope for an sdk-runtime operator turn: company dir + tool gate. */
function operatorSession(task: OperatorTask, ctx: Record<string, unknown>): SessionContext {
  const companyDir = path.join(resolveCompaniesDir(), task.company_id);
  const budget = {
    token_budget_usd: Number(ctx['token_budget_usd'] ?? 50),
    tokens_consumed_usd: Number(ctx['tokens_consumed_usd'] ?? 0),
  };
  return {
    cwd: companyDir,
    allowedTools: OPERATOR_TOOLS,
    maxTurns: OPERATOR_MAX_TURNS,
    maxBudgetUsd: budget.token_budget_usd - budget.tokens_consumed_usd,
    canUseTool: createToolGate({ task, budget, companyDir }),
  };
}

// ── Layer 2: Policy ───────────────────────────────────────────────────────────

async function policyCheck(task: OperatorTask, budgetRemaining: number): Promise<PolicyDecision> {
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
  const raw = await chargedGenerate(task.company_id, system, `Evaluate this task:\n${task.description}`, {
    jsonMode: true,
    maxTokens: 512,
    fixtureKey: `${task.role}:policy`,
  });
  return PolicyDecisionSchema.parse(parseModelJson(raw));
}

type Telem = (layer: string, data: Record<string, unknown>, success: boolean, error?: string) => void;

interface PolicyOutcome {
  /** The task to execute (possibly mitigated). */
  task: OperatorTask;
  /** When set, the task is finished — return it without executing the tool. */
  terminal?: OperatorTask;
}

/**
 * Run the full L2 gate: policy check, supervisor escalation, and verdict.
 * Fail-closed: a policy error escalates to the supervisor; if the supervisor
 * also fails, the task is blocked — it never proceeds to tool execution ungated.
 */
async function applyPolicy(task: OperatorTask, ctx: Record<string, unknown>, telem: Telem): Promise<PolicyOutcome> {
  const budgetCtx = {
    token_budget_usd: Number(ctx['token_budget_usd'] ?? 50),
    tokens_consumed_usd: Number(ctx['tokens_consumed_usd'] ?? 0),
  };
  const remaining = budgetCtx.token_budget_usd - budgetCtx.tokens_consumed_usd;

  let policy: PolicyDecision | null = null;
  let policyError: string | null = null;
  try {
    policy = await policyCheck(task, remaining);
    telem('policy', policy, policy.allowed, policy.allowed ? undefined : 'policy blocked');
    console.log(`[Operator:${task.role}] L2-Policy ✓  risk=${policy.risk_tier} allowed=${policy.allowed}`);
  } catch (err) {
    policyError = String(err);
    telem('policy', {}, false, policyError);
    console.log(`[Operator:${task.role}] L2-Policy ✗  ${policyError} — escalating to Supervisor`);
  }

  const needsSupervisor = policyError !== null || policy!.escalate_to_human;
  if (!needsSupervisor) {
    if (!policy!.allowed) {
      return { task, terminal: { ...task, status: 'blocked', error: `Policy blocked: ${policy!.reason}` } };
    }
    return { task };
  }

  console.log(`[Operator:${task.role}] ⚡ Escalating to Supervisor`);
  let decision: SupervisorDecision;
  try {
    decision = await supervisor.evaluate(task, budgetCtx);
  } catch (supErr) {
    const msg = String(supErr);
    telem('supervisor', {}, false, msg);
    console.log(`[Operator:${task.role}] Supervisor ✗  ${msg}`);
    if (policyError !== null) {
      // Both gates down — fail closed.
      return { task, terminal: { ...task, status: 'blocked', error: `Policy check failed (${policyError}); supervisor unavailable: ${msg}` } };
    }
    return { task, terminal: { ...task, status: 'failed', error: `Supervisor unavailable: ${msg}` } };
  }
  telem('supervisor', { action: decision.action, reason: decision.reason }, decision.action !== 'halt');
  console.log(`[Operator:${task.role}] Supervisor → ${decision.action}`);

  if (decision.action === 'halt') {
    return { task, terminal: { ...task, status: 'halted', error: `Supervisor halt: ${decision.reason}` } };
  }
  if (decision.action === 'mitigate' && decision.mitigated_task) {
    // Identity fields are not the LLM's to change.
    const { task_id: _tid, company_id: _cid, ...mitigation } = decision.mitigated_task;
    task = { ...task, ...mitigation };
    console.log(`[Operator:${task.role}] Task mitigated → risk=${task.risk_tier}`);
  }
  if (policy && !policy.allowed) {
    console.log(`[Operator:${task.role}] Policy block overridden by supervisor ${decision.action}`);
  }
  return { task };
}

// ── Layer 3: Tool execution ───────────────────────────────────────────────────

const ROLE_CONTEXT: Record<OperatorTask['role'], string> = {
  product: 'You are the Product-Agent. Produce product specs, user stories, and go-to-market copy.',
  engineering: 'You are the Engineering-Agent. Write code, API schemas, database queries, and technical specs.',
  'customer-success': 'You are the Customer-Success-Agent. Write onboarding flows, email sequences, and support playbooks.',
};

async function executeTool(
  task: OperatorTask,
  skills: string,
  context: Record<string, unknown>,
  session?: SessionContext,
): Promise<ToolOutput> {
  const mission = typeof context['mission'] === 'string' ? context['mission'] : '';
  const system = withJsonSchema(
    `${ROLE_CONTEXT[task.role]}

Company mission: ${mission}

Company skills:
${skills.slice(0, 2000)}`,
    EXECUTE_SCHEMA,
  );
  const raw = await chargedGenerate(task.company_id, system, `Execute this task:\n\n${task.description}`, {
    jsonMode: true,
    maxTokens: 2048,
    fixtureKey: `${task.role}:tool`,
    ...(session !== undefined ? { session } : {}),
  });
  return ToolOutputSchema.parse(parseModelJson(raw));
}

// ── Layer 4: Quality gate ─────────────────────────────────────────────────────

function qualityGate(toolOutput: ToolOutput): QualityGateResult {
  const issues: string[] = [];

  if (toolOutput.deliverable.length < 20) issues.push('Deliverable is empty or too short');
  if (toolOutput.confidence < 0.3) issues.push(`Low confidence score: ${toolOutput.confidence.toFixed(2)}`);
  if (toolOutput.artifacts.length === 0) issues.push('No artifacts listed');

  return QualityGateResultSchema.parse({
    passed: issues.length === 0,
    issues,
    validated_output: issues.length === 0 ? toolOutput.deliverable : null,
  });
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function run(task: OperatorTask): Promise<OperatorTask> {
  const stack: TelemetryEntry[] = [];

  const telem: Telem = (layer, data, success, error?) => {
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
  const isSdk = (await createModel()).provider === 'sdk';
  if (isSdk) {
    // The tool gate enforces L2 live per tool call — the advisory prompt is subsumed.
    telem('policy', { delegated_to: 'tool_gate' }, true);
    console.log(`[Operator:${task.role}] L2-Policy ✓  delegated to tool gate (sdk runtime)`);
  } else {
    const policyOutcome = await applyPolicy(task, ctx, telem);
    if (policyOutcome.terminal) return policyOutcome.terminal;
    task = policyOutcome.task;
  }

  // ── L3: Tool ─────────────────────────────────────────────────────────────
  const skills = brain.readSkills(task.company_id);
  let toolOutput: ToolOutput;
  try {
    toolOutput = await executeTool(task, skills, ctx, isSdk ? operatorSession(task, ctx) : undefined);
    telem('tool', { ...toolOutput }, true);
    console.log(`[Operator:${task.role}] L3-Tool    ✓  confidence=${toolOutput.confidence.toFixed(2)}`);
  } catch (err) {
    const msg = String(err);
    telem('tool', {}, false, msg);
    telem('learning', { failed: true }, false, msg);
    console.log(`[Operator:${task.role}] L3-Tool    ✗  ${msg}`);
    if (err instanceof SdkSessionError) {
      // A failed session still spent real money — charge it.
      brain.addConsumedCost(task.company_id, err.costUsd);
      const status = err.subtype === 'error_max_budget_usd' ? 'blocked' : 'failed';
      return { ...task, status, error: err.message };
    }
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
    confidence: toolOutput.confidence,
    artifacts: toolOutput.artifacts,
    next_actions: toolOutput.next_actions,
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
