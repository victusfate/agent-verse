import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── SDK mocks ─────────────────────────────────────────────────────────────────

const openaiState = vi.hoisted(() => ({
  lastCtor: null as Record<string, unknown> | null,
  lastParams: null as Record<string, unknown> | null,
  response: null as unknown,
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: async (params: Record<string, unknown>) => {
          openaiState.lastParams = params;
          return openaiState.response;
        },
      },
    };
    constructor(cfg: Record<string, unknown>) { openaiState.lastCtor = cfg; }
  },
}));

const anthropicState = vi.hoisted(() => ({
  lastParams: null as Record<string, unknown> | null,
  response: null as unknown,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = {
      create: async (params: Record<string, unknown>) => {
        anthropicState.lastParams = params;
        return anthropicState.response;
      },
    };
  },
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class GoogleGenerativeAI {
    getGenerativeModel() {
      return { generateContent: async () => ({ response: { text: () => 'g' } }) };
    }
  },
}));

import { OpenAIModel } from '../llm/openai.js';
import { AnthropicModel } from '../llm/anthropic.js';
import { CliModel } from '../llm/cli.js';
import { parseModelJson } from '../llm/index.js';

const OPENAI_OK = {
  choices: [{ message: { content: 'hello from openai' } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};

const ANTHROPIC_OK = {
  content: [{ type: 'text', text: 'hello from anthropic' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 7, output_tokens: 3 },
};

beforeEach(() => {
  process.env['OPENAI_API_KEY'] = 'test-openai-key';
  process.env['ANTHROPIC_API_KEY'] = 'test-anthropic-key';
  openaiState.lastCtor = null;
  openaiState.lastParams = null;
  openaiState.response = OPENAI_OK;
  anthropicState.lastParams = null;
  anthropicState.response = ANTHROPIC_OK;
});

afterEach(() => {
  delete process.env['OPENAI_API_KEY'];
  delete process.env['ANTHROPIC_API_KEY'];
  delete process.env['AGENT_PROVIDER'];
});

// ── OpenAIModel ───────────────────────────────────────────────────────────────

describe('OpenAIModel — GenerateResult contract', () => {
  it('returns text and mapped usage', async () => {
    const model = new OpenAIModel('gpt-4o-mini');
    const result = await model.generate('sys', 'prompt');
    expect(result.text).toBe('hello from openai');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('uses max_tokens and temperature for standard chat models', async () => {
    const model = new OpenAIModel('gpt-4o-mini');
    await model.generate('sys', 'prompt', { maxTokens: 111, temperature: 0.5 });
    expect(openaiState.lastParams!['max_tokens']).toBe(111);
    expect(openaiState.lastParams!['temperature']).toBe(0.5);
  });

  it('uses max_completion_tokens and omits temperature for o-series reasoning models', async () => {
    const model = new OpenAIModel('o3-mini');
    await model.generate('sys', 'prompt', { maxTokens: 222 });
    expect(openaiState.lastParams!['max_completion_tokens']).toBe(222);
    expect(openaiState.lastParams!['max_tokens']).toBeUndefined();
    expect(openaiState.lastParams!['temperature']).toBeUndefined();
  });

  it('throws a clear error on empty completion content', async () => {
    openaiState.response = { choices: [{ message: { content: null } }] };
    const model = new OpenAIModel('gpt-4o-mini');
    await expect(model.generate('sys', 'prompt')).rejects.toThrow(/empty/i);
  });

  it('throws at construction when the API key is missing', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(() => new OpenAIModel('gpt-4o-mini')).toThrow(/OPENAI_API_KEY/);
  });

  it('supports an OpenAI-compatible endpoint config (local provider)', async () => {
    const model = new OpenAIModel('llama3.2', {
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      provider: 'local',
    });
    expect(model.provider).toBe('local');
    expect(openaiState.lastCtor!['baseURL']).toBe('http://localhost:11434/v1');
    const result = await model.generate('sys', 'prompt');
    expect(result.text).toBe('hello from openai');
  });
});

// ── AnthropicModel ────────────────────────────────────────────────────────────

describe('AnthropicModel — GenerateResult contract', () => {
  it('returns text and mapped usage', async () => {
    const model = new AnthropicModel('claude-sonnet-4-6');
    const result = await model.generate('sys', 'prompt');
    expect(result.text).toBe('hello from anthropic');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it('returns the raw prefill-stripped text in jsonMode (repair happens in parseModelJson)', async () => {
    anthropicState.response = { ...ANTHROPIC_OK, content: [{ type: 'text', text: '"a": 1}' }] };
    const model = new AnthropicModel('claude-sonnet-4-6');
    const result = await model.generate('sys', 'prompt', { jsonMode: true });
    expect(result.text).toBe('"a": 1}');
    expect(parseModelJson(result.text)).toEqual({ a: 1 });
  });

  it('throws a clear error when the content array is empty', async () => {
    anthropicState.response = { ...ANTHROPIC_OK, content: [] };
    const model = new AnthropicModel('claude-sonnet-4-6');
    await expect(model.generate('sys', 'prompt')).rejects.toThrow(/empty/i);
  });

  it('throws when the response was truncated at max_tokens', async () => {
    anthropicState.response = { ...ANTHROPIC_OK, stop_reason: 'max_tokens' };
    const model = new AnthropicModel('claude-sonnet-4-6');
    await expect(model.generate('sys', 'prompt')).rejects.toThrow(/truncat/i);
  });

  it('throws at construction when the API key is missing', () => {
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => new AnthropicModel('claude-sonnet-4-6')).toThrow(/ANTHROPIC_API_KEY/);
  });
});

// ── GoogleModel ───────────────────────────────────────────────────────────────

describe('GoogleModel — boundary checks', () => {
  it('throws at construction when GEMINI_API_KEY is missing', async () => {
    delete process.env['GEMINI_API_KEY'];
    const { GoogleModel } = await import('../llm/google.js');
    expect(() => new GoogleModel('gemini-2.5-flash')).toThrow(/GEMINI_API_KEY/);
  });
});

// ── createModel factory ───────────────────────────────────────────────────────

describe('createModel — explicit id vs env override', () => {
  it('an explicit model id bypasses the AGENT_PROVIDER env override', async () => {
    process.env['AGENT_PROVIDER'] = 'openai';
    const { createModel } = await import('../llm/index.js');
    const model = await createModel('cli:echo');
    expect(model.provider).toBe('cli');
  });

  it('memoizes model instances per provider:id', async () => {
    const { createModel } = await import('../llm/index.js');
    const a = await createModel('cli:echo memo-check');
    const b = await createModel('cli:echo memo-check');
    expect(a).toBe(b);
  });
});

// ── CliModel — kill escalation ────────────────────────────────────────────────

describe('CliModel — timeout escalates SIGTERM → SIGKILL', () => {
  it('rejects with timeout and reaps a child that ignores SIGTERM', async () => {
    const stubborn = `node -e "process.on('SIGTERM', () => {}); process.stdin.resume(); setInterval(() => {}, 1000)"`;
    const model = new CliModel(stubborn, 150, 200);
    const started = Date.now();
    await expect(model.generate('sys', 'prompt')).rejects.toThrow(/timeout/i);
    expect(Date.now() - started).toBeLessThan(2500);
  }, 5000);
});
