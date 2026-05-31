import { SupervisorDecisionSchema, type OperatorTask, type SupervisorDecision } from '../schemas.js';
import { withJsonSchema, parseModelJson, createModel } from '../llm/index.js';
import { record } from '../ledger.js';

const SUPERVISOR_SCHEMA = `{
  "action": "mitigate|pass|halt",
  "reason": "string — explanation of the decision",
  "estimated_cost_usd": 0.05,
  "mitigated_task": {
    "task_id": "string",
    "company_id": "string",
    "role": "product|engineering|customer-success",
    "description": "string — revised task description with reduced scope",
    "risk_tier": "low|medium|high|critical",
    "status": "pending",
    "result": null,
    "error": null
  }
}`;

const IRREVERSIBILITY_CRITERIA = [
  'delete production data',
  'send real communications to users',
  'charge real payment methods',
  'modify live infrastructure',
  'publish to external services with real user impact',
].join('; ');

export async function evaluate(
  task: OperatorTask,
  budgetCtx: { token_budget_usd: number; tokens_consumed_usd: number },
): Promise<SupervisorDecision> {
  const model = await createModel();
  const system = withJsonSchema(
    `You are a Supervisor agent. A high/critical-risk task requires your judgment.

You have three options:
- "mitigate": reduce the task scope or split it so risk drops to low/medium, include mitigated_task
- "pass": the risk is acceptable as-is, proceed unchanged (omit mitigated_task)
- "halt": the task cannot be safely executed; it would be irreversible or destructive

Irreversibility criteria (any match → halt): ${IRREVERSIBILITY_CRITERIA}

Remaining budget: $${(budgetCtx.token_budget_usd - budgetCtx.tokens_consumed_usd).toFixed(2)} USD

Prefer mitigation over halting whenever possible.`,
    SUPERVISOR_SCHEMA,
  );

  const raw = await model.generate(system, `Evaluate this task:\n${task.description}`, {
    jsonMode: true,
    maxTokens: 1024,
  });

  const raw_parsed = parseModelJson(raw) as Record<string, unknown>;
  const decision = SupervisorDecisionSchema.parse({ task_id: task.task_id, ...raw_parsed });

  record(task.company_id, 'supervisor.decision', {
    task_id: task.task_id,
    action: decision.action,
    reason: decision.reason,
    estimated_cost_usd: decision.estimated_cost_usd,
  }, 'supervisor');

  return decision;
}
