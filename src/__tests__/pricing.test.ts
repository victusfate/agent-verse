import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from '../llm/pricing.js';

describe('estimateCostUsd', () => {
  it('prices usage for a cloud provider above zero', () => {
    const cost = estimateCostUsd({ provider: 'openai', id: 'gpt-4o-mini' }, { inputTokens: 100_000, outputTokens: 50_000 });
    expect(cost).toBeGreaterThan(0);
  });

  it('scales linearly with token usage', () => {
    const small = estimateCostUsd({ provider: 'anthropic', id: 'claude-sonnet-4-6' }, { inputTokens: 1_000, outputTokens: 1_000 });
    const large = estimateCostUsd({ provider: 'anthropic', id: 'claude-sonnet-4-6' }, { inputTokens: 2_000, outputTokens: 2_000 });
    expect(large).toBeCloseTo(small * 2, 10);
  });

  it('falls back to a character-based estimate when usage is absent', () => {
    const cost = estimateCostUsd({ provider: 'openai', id: 'gpt-4o-mini' }, undefined, 'x'.repeat(4_000));
    expect(cost).toBeGreaterThan(0);
  });

  it('treats local, cli, and simulated providers as free', () => {
    for (const provider of ['local', 'cli', 'simulated'] as const) {
      expect(estimateCostUsd({ provider, id: 'whatever' }, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
    }
  });
});
