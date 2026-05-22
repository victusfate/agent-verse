/**
 * Phase 4 — Monitor-Agent (continuous self-improvement engine)
 *
 * Task 4.1 — Friction Profiling:   scan telemetry for failures and drop-offs.
 * Task 4.2 — Root-Cause Diagnosis: LLM-powered friction classification.
 * Task 4.3 — Code hot-fix:         stub (would open a PR in production).
 * Task 4.4 — Brain Synthesis:      rewrites skills.md with improvements learned this cycle.
 */
import { MonitorReportSchema, type MonitorReport, type OperatorTask } from '../schemas.js';
import { withJsonSchema, parseModelJson, createModel } from '../llm/index.js';
import * as brain from '../companyBrain.js';
import { record, queryFailures } from '../ledger.js';

const SYSTEM_PROMPT = `You are the Monitor-Agent — an asynchronous supervisory intelligence.

Your role:
1. Analyse telemetry and task results to identify friction (failures, low-confidence outputs, quality gate failures).
2. Diagnose the root cause and classify it as code_fix, data_optimization, skills_update, or none.
3. If skills_update, rewrite the entire skills.md with improvements learned from this cycle.
4. Decide if the system has accomplished enough to halt for this venture cycle.

Be specific. If skills need updating, include concrete new playbooks, API examples, or operational rules.`;

const SCHEMA_HINT = `{
  "friction_summary": "string — plain-English summary of identified friction points",
  "mitigation_type": "code_fix|data_optimization|skills_update|none",
  "skills_update": "string (full replacement skills.md content, only if mitigation_type=skills_update) or null",
  "iteration_complete": true
}`;

export async function run(
  companyId: string,
  tasks: OperatorTask[],
  cycle: number,
): Promise<MonitorReport> {
  console.log(`\n[Monitor-Agent] Starting friction profiling (cycle ${cycle})...`);

  const failures = queryFailures(companyId);
  const currentSkills = brain.readSkills(companyId);
  const completed = tasks.filter(t => t.status === 'completed').length;

  console.log(`[Monitor-Agent] Tasks: ${completed}/${tasks.length} completed, ${failures.length} friction events`);

  const analysisPayload = JSON.stringify({
    cycle,
    task_summaries: tasks.map(t => ({
      task_id: t.task_id.slice(0, 8),
      role: t.role,
      status: t.status,
      error: t.error,
      result_preview: (t.result ?? '').slice(0, 200),
    })),
    failure_count: failures.length,
    failure_samples: failures.slice(0, 5),
    current_skills_preview: currentSkills.slice(0, 1000),
  }, null, 2);

  const model = await createModel();
  const raw = await model.generate(
    withJsonSchema(SYSTEM_PROMPT, SCHEMA_HINT),
    `Analyse this execution cycle and diagnose any friction:\n\n${analysisPayload}\n\n` +
    `Cycle ${cycle}: ${failures.length === 0 ? 'All tasks succeeded.' : `${failures.length} failures detected.`} ` +
    `Mark iteration_complete=true if the venture milestone is substantially achieved.`,
    { jsonMode: true, maxTokens: 3000 },
  );

  const parsed = parseModelJson(raw) as Record<string, unknown>;
  const report = MonitorReportSchema.parse({
    company_id: companyId,
    cycle,
    friction_points: failures.slice(0, 10),
    diagnosis: parsed['friction_summary'],
    mitigation_type: parsed['mitigation_type'],
    skills_update: parsed['skills_update'] ?? null,
    iteration_complete: parsed['iteration_complete'] ?? false,
  });

  record(companyId, 'monitor.report', report, 'monitor');

  // Task 4.4 — update Company Brain if needed
  if (report.mitigation_type === 'skills_update' && report.skills_update) {
    brain.writeSkills(companyId, report.skills_update);
    console.log(`[Monitor-Agent] ✓ skills.md updated (${report.skills_update.length} chars)`);
    record(companyId, 'company.brain.skills_updated', { cycle, chars: report.skills_update.length }, 'monitor');
  }

  // Task 4.3 — code hot-fix stub
  if (report.mitigation_type === 'code_fix') {
    console.log('[Monitor-Agent] ⚙ Code hot-fix required — would open sub-agent PR in production');
    record(companyId, 'monitor.hotfix_stub', { cycle, diagnosis: report.diagnosis.slice(0, 200) }, 'monitor');
  }

  const status = report.iteration_complete ? 'COMPLETE' : 'CONTINUING';
  console.log(`[Monitor-Agent] Diagnosis: ${report.mitigation_type} | Iteration: ${status}`);
  return report;
}
