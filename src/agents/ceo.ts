/**
 * Phase 2 — CEO-Agent
 * Receives the venture payload, initialises the Company Brain, and provisions
 * one OperatorTask per role (product / engineering / customer-success).
 */
import { BrainInitSchema, OperatorTaskSchema, type OperatorTask, type VenturePayload } from '../schemas.js';
import { withJsonSchema, parseModelJson, createModel } from '../llm/index.js';
import * as brain from '../companyBrain.js';
import { initLedger, record } from '../ledger.js';

const SYSTEM_PROMPT = `You are the CEO-Agent of an autonomous corporate AI ecosystem.

You receive a validated venture payload and must:
1. Write a structured context_framework describing the company's mission, constraints, and initial capabilities.
2. Write an initial skills.md listing core competencies, APIs to integrate, and operational playbooks.
3. Provision exactly three operator tasks — one each for product, engineering, and customer-success — that together deliver the venture's first milestone.

Be specific and actionable. Each task description is a complete, executable work order.`;

const SCHEMA_HINT = `{
  "context_framework": {
    "mission": "string",
    "constraints": ["string"],
    "initial_capabilities": ["string"]
  },
  "skills_md": "string (full markdown document)",
  "operator_tasks": [
    { "role": "product",          "description": "string", "risk_tier": "low|medium|high|critical" },
    { "role": "engineering",      "description": "string", "risk_tier": "low|medium|high|critical" },
    { "role": "customer-success", "description": "string", "risk_tier": "low|medium|high|critical" }
  ]
}`;

export async function run(venture: VenturePayload): Promise<[string, OperatorTask[]]> {
  const companyId = venture.company_name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  console.log(`[CEO-Agent] Provisioning company: ${companyId}`);

  initLedger();
  record(companyId, 'company.created', { venture }, 'ceo');

  const model = await createModel();
  const raw = await model.generate(
    withJsonSchema(SYSTEM_PROMPT, SCHEMA_HINT),
    `Initialise company for this venture:\n\n${JSON.stringify(venture, null, 2)}`,
    { jsonMode: true, maxTokens: 2048 },
  );

  const init = BrainInitSchema.parse(parseModelJson(raw));

  // Task 2.2 — write Company Brain
  const context = {
    ...init.context_framework,
    company_id: companyId,
    venture,
    token_budget_usd: venture.estimated_token_cost_ceiling_usd,
  };
  brain.writeContextFramework(companyId, context);
  brain.writeSkills(companyId, init.skills_md);
  record(companyId, 'company.brain.initialised', { context_keys: Object.keys(context) }, 'ceo');
  console.log(`[CEO-Agent] ✓ Company Brain written`);

  // Task 2.3 — provision operator tasks
  const tasks: OperatorTask[] = init.operator_tasks.map(raw =>
    OperatorTaskSchema.parse({ company_id: companyId, ...raw }),
  );

  for (const task of tasks) {
    record(companyId, 'task.created', task, 'ceo');
    console.log(`[CEO-Agent]   → Task [${task.role}]: ${task.description.slice(0, 60)}...`);
  }

  return [companyId, tasks];
}
