/**
 * Runtime selection for agent turns.
 *
 * 'api'  — existing Model providers (Anthropic/OpenAI/Google/Ollama/CLI/simulated)
 * 'sdk'  — Claude Agent SDK sessions through the local Claude Code binary
 *
 * Resolution order: explicit flag → AGENT_RUNTIME env → auto-fallback
 * (no ANTHROPIC_API_KEY and `claude` on PATH → sdk) → 'api'.
 */
import { execFileSync } from 'node:child_process';
import { detectProvider } from './index.js';

export type AgentRuntime = 'sdk' | 'api';

export interface RuntimeInputs {
  /** Explicit --runtime flag value, already validated by the CLI boundary. */
  flag?: AgentRuntime;
  /** Environment to consult; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Injectable PATH probe for tests; defaults to a real `which claude`. */
  claudeOnPath?: boolean;
}

export function claudeBinaryOnPath(): boolean {
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function parseRuntime(value: string, source: string): AgentRuntime {
  if (value === 'sdk' || value === 'api') return value;
  throw new Error(`${source} must be 'sdk' or 'api', got '${value}'`);
}

export function resolveRuntime(inputs: RuntimeInputs = {}): AgentRuntime {
  const env = inputs.env ?? process.env;

  if (inputs.flag !== undefined) return inputs.flag;
  const envRuntime = env['AGENT_RUNTIME'];
  if (envRuntime !== undefined) return parseRuntime(envRuntime, 'AGENT_RUNTIME');

  const onPath = inputs.claudeOnPath ?? claudeBinaryOnPath();
  if (!env['ANTHROPIC_API_KEY'] && onPath) return 'sdk';
  return 'api';
}

/** The sdk runtime drives the local Claude Code binary — Claude models only. */
export function assertSdkModel(modelId: string): void {
  if (detectProvider(modelId) !== 'anthropic') {
    throw new Error(
      `The sdk runtime only supports Claude models, got '${modelId}'.\n` +
      `Drop --runtime sdk or choose a Claude model (e.g. claude-sonnet-4-6).`,
    );
  }
}
