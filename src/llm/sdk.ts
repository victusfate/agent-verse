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
        throw new Error(`SDK session failed: ${message.subtype}`);
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
