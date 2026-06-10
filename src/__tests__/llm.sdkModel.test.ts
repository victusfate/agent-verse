import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Agent SDK boundary — the factory form avoids loading the real module.
const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

/** Build an async iterable that yields SDK messages ending in a result. */
function sdkStream(messages: Array<Record<string, unknown>>): AsyncIterable<unknown> {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

function successResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    result: '{"deliverable":"sentinel output"}',
    usage: { input_tokens: 1234, output_tokens: 567 },
    total_cost_usd: 0.0421,
    ...overrides,
  };
}

describe('SdkModel', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('generates via the SDK and returns text, usage, and actual cost', async () => {
    queryMock.mockReturnValue(sdkStream([successResult()]));

    const { createModel } = await import('../llm/index.js');
    const model = await createModel('claude-sonnet-4-6', 'sdk');

    expect(model.provider).toBe('sdk');

    const result = await model.generate('You are the Engineering-Agent.', 'Build the API.', {
      session: {
        cwd: '/tmp/companies/acme',
        allowedTools: ['Read', 'Write', 'Bash'],
        maxTurns: 10,
        maxBudgetUsd: 7.5,
      },
    });

    expect(result.text).toBe('{"deliverable":"sentinel output"}');
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 567 });
    expect(result.costUsd).toBe(0.0421);
  });

  it('maps the session context onto SDK query options', async () => {
    queryMock.mockReturnValue(sdkStream([successResult()]));
    const gate = vi.fn();

    const { createModel } = await import('../llm/index.js');
    const model = await createModel('claude-sonnet-4-6', 'sdk');
    await model.generate('system text', 'prompt text', {
      session: {
        cwd: '/tmp/companies/acme',
        allowedTools: ['Read', 'Glob'],
        maxTurns: 4,
        maxBudgetUsd: 2.25,
        canUseTool: gate,
      },
    });

    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'prompt text',
      options: {
        systemPrompt: 'system text',
        model: 'claude-sonnet-4-6',
        permissionMode: 'dontAsk',
        persistSession: false,
        cwd: '/tmp/companies/acme',
        allowedTools: ['Read', 'Glob'],
        maxTurns: 4,
        maxBudgetUsd: 2.25,
        canUseTool: gate,
      },
    });
  });

  it('omits session-scoped options when no session context is given', async () => {
    queryMock.mockReturnValue(sdkStream([successResult()]));

    const { createModel } = await import('../llm/index.js');
    const model = await createModel('claude-sonnet-4-6', 'sdk');
    await model.generate('system text', 'prompt text');

    expect(queryMock).toHaveBeenCalledWith({
      prompt: 'prompt text',
      options: {
        systemPrompt: 'system text',
        model: 'claude-sonnet-4-6',
        permissionMode: 'dontAsk',
        persistSession: false,
      },
    });
  });
});
