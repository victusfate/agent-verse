/**
 * Read-mostly session contexts for the non-operator agents (Idea, CEO,
 * Monitor) on the sdk runtime. Their tool sets are statically safe, so no
 * tool gate is attached. Returns a spreadable options fragment: empty for
 * api-runtime models.
 */
import type { Model, SessionContext } from '../llm/index.js';

const READ_MOSTLY_MAX_TURNS = 4;

export function readMostlySession(
  model: Model,
  cwd: string,
  allowedTools: string[],
): { session: SessionContext } | Record<string, never> {
  if (model.provider !== 'sdk') return {};
  return { session: { cwd, allowedTools, maxTurns: READ_MOSTLY_MAX_TURNS } };
}
