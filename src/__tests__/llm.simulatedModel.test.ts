import { describe, it, expect } from 'vitest';
import { SimulatedModel } from '../llm/simulated.js';
import { FIXTURES } from '../simulation/fixtures.js';
import { OperatorTaskSchema } from '../schemas.js';

describe('SimulatedModel — explicit fixture keys', () => {
  it('returns the fixture for a known key', async () => {
    const model = new SimulatedModel();
    const { text } = await model.generate('sys', 'prompt', { fixtureKey: 'product:tool' });
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('deliverable');
  });

  it('is deterministic — same key returns same output', async () => {
    const model = new SimulatedModel();
    const { text: a } = await model.generate('sys', 'task 1', { fixtureKey: 'engineering:tool' });
    const { text: b } = await model.generate('other sys', 'task 2', { fixtureKey: 'engineering:tool' });
    expect(a).toBe(b);
  });

  it('throws when fixtureKey is not provided', async () => {
    const model = new SimulatedModel();
    await expect(model.generate('sys', 'prompt')).rejects.toThrow(/fixtureKey/);
  });

  it('throws on an unknown fixture key instead of falling back', async () => {
    const model = new SimulatedModel();
    await expect(model.generate('sys', 'prompt', { fixtureKey: 'nope:nothing' }))
      .rejects.toThrow(/nope:nothing/);
  });

  it('returns the supervisor fixture for supervisor:policy', async () => {
    const model = new SimulatedModel();
    const { text } = await model.generate('sys', 'prompt', { fixtureKey: 'supervisor:policy' });
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty('action');
    expect(parsed).toHaveProperty('reason');
  });

  it('exposes provider as simulated', () => {
    expect(new SimulatedModel().provider).toBe('simulated');
  });

  it('exposes id as fixture', () => {
    expect(new SimulatedModel().id).toBe('fixture');
  });
});

describe('fixture map — covers every key production agents use', () => {
  const roles = OperatorTaskSchema.shape.role.options;

  it('has a :policy and :tool fixture for every operator role', () => {
    for (const role of roles) {
      expect(FIXTURES, `missing ${role}:policy`).toHaveProperty(`${role}:policy`);
      expect(FIXTURES, `missing ${role}:tool`).toHaveProperty(`${role}:tool`);
    }
  });

  it('has fixtures for the static agent keys', () => {
    for (const key of ['idea:generate', 'ceo:init', 'supervisor:policy', 'monitor:diagnose']) {
      expect(FIXTURES, `missing ${key}`).toHaveProperty(key);
    }
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
