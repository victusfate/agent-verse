/**
 * SdkModel — runs an agent turn as a Claude Agent SDK session through the
 * locally installed Claude Code binary (logged-in auth, no API key).
 *
 * One generate() call = one stateless session: the company brain on disk is
 * the memory, not the session. Tool access and risk gating arrive via
 * LlmRequestOptions.session (see SessionContext in ./index.js).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Model, LlmRequestOptions, GenerateResult } from './index.js';

type ErrorSubtype =
  | 'error_during_execution'
  | 'error_max_turns'
  | 'error_max_budget_usd'
  | 'error_max_structured_output_retries';

const SUBTYPE_REASON: Record<ErrorSubtype, string> = {
  error_max_budget_usd: 'session budget exceeded',
  error_max_turns: 'session exceeded max turns',
  error_during_execution: 'error during execution',
  error_max_structured_output_retries: 'structured output retries exhausted',
};

/**
 * A session that ended on an error subtype. Carries the subtype so callers
 * can distinguish budget exhaustion from turn caps, and the actual cost so
 * a failed session is still charged to the venture.
 */
export class SdkSessionError extends Error {
  readonly subtype: ErrorSubtype;
  readonly costUsd: number;

  constructor(subtype: ErrorSubtype, costUsd: number, details: string[]) {
    const detail = details.length > 0 ? `: ${details.join('; ')}` : '';
    super(`SDK session failed — ${SUBTYPE_REASON[subtype]}${detail}`);
    this.name = 'SdkSessionError';
    this.subtype = subtype;
    this.costUsd = costUsd;
  }
}

export class SdkModel implements Model {
  readonly provider = 'sdk' as const;
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options?: LlmRequestOptions,
  ): Promise<GenerateResult> {
    const session = options?.session;

    const stream = query({
      prompt,
      options: {
        systemPrompt: systemInstruction,
        model: this.id,
        permissionMode: 'dontAsk',
        persistSession: false,
        ...(session !== undefined ? {
          cwd: session.cwd,
          allowedTools: session.allowedTools,
          maxTurns: session.maxTurns,
          ...(session.maxBudgetUsd !== undefined ? { maxBudgetUsd: session.maxBudgetUsd } : {}),
          ...(session.canUseTool !== undefined ? { canUseTool: session.canUseTool } : {}),
        } : {}),
      },
    });

    for await (const message of stream) {
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success') {
        throw new SdkSessionError(message.subtype, message.total_cost_usd, message.errors);
      }
      return {
        text: message.result,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        costUsd: message.total_cost_usd,
      };
    }
    throw new Error('SDK session ended without a result message');
  }
}
