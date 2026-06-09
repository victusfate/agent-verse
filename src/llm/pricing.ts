/**
 * Approximate per-million-token USD rates by provider.
 * This is a safety estimate that makes the budget hard-halt fire-able —
 * it is not billing-grade metering. Refresh occasionally.
 */
import type { LlmProviderType, TokenUsage } from './index.js';

const RATES: Record<LlmProviderType, { input: number; output: number }> = {
  anthropic: { input: 3, output: 15 },
  openai: { input: 2.5, output: 10 },
  google: { input: 0.3, output: 2.5 },
  local: { input: 0, output: 0 },
  cli: { input: 0, output: 0 },
  simulated: { input: 0, output: 0 },
};

export function estimateCostUsd(
  model: { provider: LlmProviderType; id: string },
  usage?: TokenUsage,
  fallbackText?: string,
): number {
  const rate = RATES[model.provider];
  if (usage) {
    return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
  }
  // chars/4 ≈ tokens; price it all at the output rate for a conservative estimate
  const approxTokens = (fallbackText?.length ?? 0) / 4;
  return (approxTokens * rate.output) / 1_000_000;
}
