import { describe, it, expect } from 'vitest';
import { detectProvider, stripProviderPrefix } from '../llm/index.js';

describe('detectProvider', () => {
  it('returns anthropic for claude- prefix', () => {
    expect(detectProvider('claude-sonnet-4-6')).toBe('anthropic');
  });
  it('returns anthropic for anthropic/ prefix', () => {
    expect(detectProvider('anthropic/claude-3-5-sonnet')).toBe('anthropic');
  });
  it('returns openai for gpt- prefix', () => {
    expect(detectProvider('gpt-4o-mini')).toBe('openai');
  });
  it('returns openai for o1- prefix', () => {
    expect(detectProvider('o1-mini')).toBe('openai');
  });
  it('returns openai for o3- prefix', () => {
    expect(detectProvider('o3-mini')).toBe('openai');
  });
  it('returns google for gemini- prefix', () => {
    expect(detectProvider('gemini-2.5-flash')).toBe('google');
  });
  it('returns google for google/ prefix', () => {
    expect(detectProvider('google/gemini-pro')).toBe('google');
  });
  it('returns local for llama prefix', () => {
    expect(detectProvider('llama3.2')).toBe('local');
  });
  it('returns local for qwen prefix', () => {
    expect(detectProvider('qwen2.5:14b')).toBe('local');
  });
  it('returns local for ollama/ prefix', () => {
    expect(detectProvider('ollama/llama3.2')).toBe('local');
  });
  it('falls back to openai for unknown model strings', () => {
    expect(detectProvider('some-unknown-model-xyz')).toBe('openai');
  });
});

describe('stripProviderPrefix', () => {
  it('strips anthropic/ prefix', () => {
    expect(stripProviderPrefix('anthropic/claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });
  it('strips ollama/ prefix', () => {
    expect(stripProviderPrefix('ollama/llama3.2')).toBe('llama3.2');
  });
  it('strips google/ prefix', () => {
    expect(stripProviderPrefix('google/gemini-pro')).toBe('gemini-pro');
  });
  it('leaves bare model IDs unchanged', () => {
    expect(stripProviderPrefix('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
    expect(stripProviderPrefix('gpt-4o')).toBe('gpt-4o');
  });
});
