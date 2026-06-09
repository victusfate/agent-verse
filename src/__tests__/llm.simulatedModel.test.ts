import { describe, it, expect, vi } from 'vitest';
import { SimulatedModel } from '../llm/simulated.js';

describe('SimulatedModel — fixture lookup', () => {
  it('returns a JSON string for a known fixture key', async () => {
    const model = new SimulatedModel();
    const { text: result } = await model.generate('You are the Product-Agent.', 'Execute this task');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('deliverable');
  });

  it('is deterministic — same system prompt returns same output', async () => {
    const model = new SimulatedModel();
    const system = 'You are the Engineering-Agent.';
    const { text: a } = await model.generate(system, 'task 1');
    const { text: b } = await model.generate(system, 'task 2');
    expect(a).toBe(b);
  });

  it('returns a fallback fixture and warns when key is unknown', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const model = new SimulatedModel();
    const { text: result } = await model.generate('You are an unknown-agent.', 'task');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('deliverable');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('exposes provider as simulated', () => {
    expect(new SimulatedModel().provider).toBe('simulated');
  });

  it('exposes id as fixture', () => {
    expect(new SimulatedModel().id).toBe('fixture');
  });
});

// ops-hardening slice 2: BUG-3
describe('SimulatedModel — supervisor fixture', () => {
  it('returns supervisor fixture (not FALLBACK) when called with supervisor system prompt (BUG-3)', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const model = new SimulatedModel();
    const { text: result } = await model.generate(
      'You are a Supervisor agent. Evaluate risk.',
      'Evaluate this task:\nBuild a registration endpoint',
    );
    const parsed = JSON.parse(result);
    // The supervisor fixture should have action/reason/estimated_cost_usd
    expect(parsed).toHaveProperty('action');
    expect(parsed).toHaveProperty('reason');
    // No fallback warning should be emitted
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('SimulatedModel — factory detection', () => {
  it('detectProvider returns simulated for simulated model id', async () => {
    const { detectProvider } = await import('../llm/index.js');
    expect(detectProvider('simulated')).toBe('simulated');
  });

  it('createModel returns SimulatedModel for simulated id', async () => {
    const { createModel } = await import('../llm/index.js');
    const model = await createModel('simulated');
    expect(model.provider).toBe('simulated');
  });
});
