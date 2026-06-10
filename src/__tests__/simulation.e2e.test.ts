import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// End-to-end: the full Idea → CEO → Operators → Monitor loop must complete
// with the simulated provider — the caller's view of `AGENT_MODEL=simulated`.

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-sim-e2e-'));
  process.env['COMPANIES_DIR'] = path.join(tmpRoot, 'companies');
  process.env['AGENT_MODEL'] = 'simulated';
});

afterEach(() => {
  delete process.env['COMPANIES_DIR'];
  delete process.env['AGENT_MODEL'];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('simulated end-to-end run', () => {
  it('completes the full graph with all tasks completed', async () => {
    const { runGraph } = await import('../graph.js');
    const state = await runGraph({});

    expect(state.companyId).toBe('sim-venture');
    expect(state.iterationComplete).toBe(true);
    expect(state.operatorTasks).toHaveLength(3);
    expect(state.operatorTasks.every(t => t.status === 'completed')).toBe(true);
  }, 30_000);

  it('writes the Company Brain under COMPANIES_DIR', async () => {
    const { runGraph } = await import('../graph.js');
    await runGraph({});
    const brainDir = path.join(tmpRoot, 'companies', 'sim-venture');
    expect(fs.existsSync(path.join(brainDir, 'context_framework.json'))).toBe(true);
    expect(fs.existsSync(path.join(brainDir, 'skills.md'))).toBe(true);
  }, 30_000);
});
