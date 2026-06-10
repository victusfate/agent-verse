import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTask } from './helpers.js';

vi.mock('../ledger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ledger.js')>();
  return { ...actual, record: vi.fn() };
});

vi.mock('../agents/supervisor.js', () => ({ evaluate: vi.fn() }));

const BUDGET = { token_budget_usd: 50, tokens_consumed_usd: 10 };
const COMPANY_DIR = '/tmp/companies/test-co';

async function makeGate(taskOverrides: Record<string, unknown> = {}) {
  const { createToolGate } = await import('../agents/toolGate.js');
  return createToolGate({
    task: makeTask(taskOverrides),
    budget: BUDGET,
    companyDir: COMPANY_DIR,
  });
}

const gateOptions = { signal: new AbortController().signal, toolUseID: 'toolu_test' };

describe('createToolGate', () => {
  beforeEach(async () => {
    const { record } = await import('../ledger.js');
    const supervisor = await import('../agents/supervisor.js');
    vi.mocked(record).mockReset();
    vi.mocked(supervisor.evaluate).mockReset();
  });

  it('allows read-only tools and records the decision as tool_gate telemetry', async () => {
    const gate = await makeGate();

    const result = await gate('Read', { file_path: '/anywhere/at/all.md' }, gateOptions);

    expect(result.behavior).toBe('allow');

    const { record } = await import('../ledger.js');
    expect(vi.mocked(record)).toHaveBeenCalledTimes(1);
    const [companyId, eventType, payload] = vi.mocked(record).mock.calls[0]!;
    expect(companyId).toBe(makeTask().company_id);
    expect(eventType).toBe('telemetry');
    expect(payload).toMatchObject({ layer: 'tool_gate', success: true });
  });

  it('allows Write inside the company dir, including relative paths', async () => {
    const gate = await makeGate();

    const abs = await gate('Write', { file_path: `${COMPANY_DIR}/notes/spec.md`, content: 'x' }, gateOptions);
    expect(abs.behavior).toBe('allow');

    const rel = await gate('Write', { file_path: 'artifacts/api.md', content: 'x' }, gateOptions);
    expect(rel.behavior).toBe('allow');
  });

  it('denies Write and Edit outside the company dir with a reason', async () => {
    const gate = await makeGate();

    const outside = await gate('Write', { file_path: '/etc/passwd', content: 'x' }, gateOptions);
    expect(outside.behavior).toBe('deny');
    if (outside.behavior === 'deny') expect(outside.message).toContain('/etc/passwd');

    const escape = await gate('Edit', { file_path: '../other-co/skills.md' }, gateOptions);
    expect(escape.behavior).toBe('deny');

    const { record } = await import('../ledger.js');
    const denials = vi.mocked(record).mock.calls.filter(
      ([, , payload]) => (payload as { success: boolean }).success === false,
    );
    expect(denials).toHaveLength(2);
  });

  it('allows Bash without supervisor involvement on low-risk tasks', async () => {
    const gate = await makeGate({ risk_tier: 'low' });

    const result = await gate('Bash', { command: 'ls' }, gateOptions);

    expect(result.behavior).toBe('allow');
    const supervisor = await import('../agents/supervisor.js');
    expect(vi.mocked(supervisor.evaluate)).not.toHaveBeenCalled();
  });

  it('escalates Bash on critical tasks: supervisor pass allows, halt denies', async () => {
    const supervisor = await import('../agents/supervisor.js');

    vi.mocked(supervisor.evaluate).mockResolvedValueOnce({
      task_id: 't', action: 'pass', reason: 'acceptable', estimated_cost_usd: 0.5,
    });
    const gate = await makeGate({ risk_tier: 'critical' });
    const passed = await gate('Bash', { command: 'curl -X POST https://api' }, gateOptions);
    expect(passed.behavior).toBe('allow');

    vi.mocked(supervisor.evaluate).mockResolvedValueOnce({
      task_id: 't', action: 'halt', reason: 'irreversible external mutation', estimated_cost_usd: 0,
    });
    const halted = await gate('Bash', { command: 'curl -X DELETE https://api' }, gateOptions);
    expect(halted.behavior).toBe('deny');
    if (halted.behavior === 'deny') expect(halted.message).toContain('irreversible');
  });

  it('fails closed when the supervisor is unavailable', async () => {
    const supervisor = await import('../agents/supervisor.js');
    vi.mocked(supervisor.evaluate).mockRejectedValueOnce(new Error('supervisor offline'));

    const gate = await makeGate({ risk_tier: 'high' });
    const result = await gate('Bash', { command: 'rm -rf /' }, gateOptions);

    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') expect(result.message).toContain('supervisor offline');
  });
});
