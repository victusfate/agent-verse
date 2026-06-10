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

  it('rejects with a budget-tagged error carrying actual cost when the session hits maxBudgetUsd', async () => {
    queryMock.mockReturnValue(sdkStream([{
      type: 'result',
      subtype: 'error_max_budget_usd',
      errors: ['budget exceeded'],
      total_cost_usd: 5.01,
      usage: { input_tokens: 50_000, output_tokens: 9_000 },
    }]));

    const { createModel } = await import('../llm/index.js');
    const { SdkSessionError } = await import('../llm/sdk.js');
    const model = await createModel('claude-sonnet-4-6', 'sdk');

    const err = await model.generate('s', 'p').then(
      () => { throw new Error('expected rejection'); },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SdkSessionError);
    const sessionErr = err as InstanceType<typeof SdkSessionError>;
    expect(sessionErr.subtype).toBe('error_max_budget_usd');
    expect(sessionErr.costUsd).toBe(5.01);
    expect(sessionErr.message).toContain('budget');
  });

  it('rejects with a turns-tagged error when the session hits maxTurns', async () => {
    queryMock.mockReturnValue(sdkStream([{
      type: 'result',
      subtype: 'error_max_turns',
      errors: [],
      total_cost_usd: 0.9,
      usage: { input_tokens: 10, output_tokens: 10 },
    }]));

    const { createModel } = await import('../llm/index.js');
    const { SdkSessionError } = await import('../llm/sdk.js');
    const model = await createModel('claude-sonnet-4-6', 'sdk');

    const err = await model.generate('s', 'p').then(
      () => { throw new Error('expected rejection'); },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(SdkSessionError);
    const sessionErr = err as InstanceType<typeof SdkSessionError>;
    expect(sessionErr.subtype).toBe('error_max_turns');
    expect(sessionErr.costUsd).toBe(0.9);
    expect(sessionErr.message).toContain('turns');
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
