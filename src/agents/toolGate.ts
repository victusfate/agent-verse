/**
 * Tool gate — the L2 risk gate realized as a Claude Agent SDK canUseTool
 * callback. Enforces per-tool-call decisions live during an sdk-runtime
 * session instead of one advisory policy prompt before it:
 *
 *   read-only tools          → allow
 *   Write/Edit               → allow only inside the company dir
 *   Bash / anything else     → high/critical task risk escalates to the
 *                              Supervisor (halt → deny); supervisor failure
 *                              denies (fail closed)
 *
 * Every decision is recorded to the ledger as tool_gate telemetry.
 */
import path from 'node:path';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { TelemetryEntrySchema, type OperatorTask } from '../schemas.js';
import { record } from '../ledger.js';
import * as supervisor from './supervisor.js';

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const PATH_SCOPED_TOOLS = new Set(['Write', 'Edit']);

export interface ToolGateArgs {
  task: OperatorTask;
  budget: { token_budget_usd: number; tokens_consumed_usd: number };
  companyDir: string;
}

function insideDir(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(dir, target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createToolGate({ task, budget, companyDir }: ToolGateArgs): CanUseTool {
  const telem = (tool: string, decision: PermissionResult, detail: Record<string, unknown>) => {
    const entry = TelemetryEntrySchema.parse({
      company_id: task.company_id,
      task_id: task.task_id,
      agent_role: task.role,
      layer: 'tool_gate',
      data: { tool, behavior: decision.behavior, ...detail },
      success: decision.behavior === 'allow',
      error: decision.behavior === 'deny' ? decision.message : null,
    });
    record(task.company_id, 'telemetry', entry, `operator.${task.role}`);
  };

  const decide = (tool: string, decision: PermissionResult, detail: Record<string, unknown> = {}): PermissionResult => {
    telem(tool, decision, detail);
    return decision;
  };

  return async (toolName, input) => {
    if (READ_ONLY_TOOLS.has(toolName)) {
      return decide(toolName, { behavior: 'allow', updatedInput: input });
    }

    if (PATH_SCOPED_TOOLS.has(toolName)) {
      const target = typeof input['file_path'] === 'string' ? input['file_path'] : '';
      if (target !== '' && insideDir(companyDir, target)) {
        return decide(toolName, { behavior: 'allow', updatedInput: input }, { target });
      }
      return decide(toolName, {
        behavior: 'deny',
        message: `${toolName} outside the company dir is not permitted: '${target}'`,
      }, { target });
    }

    // Bash and anything else: escalate by task risk tier.
    if (task.risk_tier !== 'high' && task.risk_tier !== 'critical') {
      return decide(toolName, { behavior: 'allow', updatedInput: input }, { risk_tier: task.risk_tier });
    }

    try {
      const decision = await supervisor.evaluate(task, budget);
      if (decision.action === 'halt') {
        return decide(toolName, {
          behavior: 'deny',
          message: `Supervisor halt: ${decision.reason}`,
        }, { supervisor: decision.action });
      }
      return decide(toolName, { behavior: 'allow', updatedInput: input }, { supervisor: decision.action });
    } catch (err) {
      // Fail closed — gate down means no execution.
      return decide(toolName, {
        behavior: 'deny',
        message: `Supervisor unavailable, denying ${toolName}: ${String(err)}`,
      }, { supervisor: 'error' });
    }
  };
}
