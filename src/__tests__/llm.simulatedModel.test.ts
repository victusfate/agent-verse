import { describe, it, expect, vi } from 'vitest';
import { SimulatedModel } from '../llm/simulated.js';

describe('SimulatedModel — fixture lookup', () => {
  it('returns a JSON string for a known fixture key', async () => {
    const model = new SimulatedModel();
    const result = await model.generate('You are the Product-Agent.', 'Execute this task');
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('deliverable');
  });

  it('is deterministic — same system prompt returns same output', async () => {
    const model = new SimulatedModel();
    const system = 'You are the Engineering-Agent.';
    const a = await model.generate(system, 'task 1');
    const b = await model.generate(system, 'task 2');
    expect(a).toBe(b);
  });

  it('returns a fallback fixture and warns when key is unknown', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const model = new SimulatedModel();
    const result = await model.generate('You are an unknown-agent.', 'task');
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
