import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { VenturePayload, OperatorTask, MonitorReport } from '../schemas.js';

vi.mock('../agents/idea.js', () => ({ run: vi.fn() }));
vi.mock('../agents/ceo.js', () => ({ run: vi.fn() }));
vi.mock('../agents/operator.js', () => ({ run: vi.fn() }));
vi.mock('../agents/monitor.js', () => ({ run: vi.fn() }));
vi.mock('../ledger.js', () => ({ record: vi.fn(), initLedger: vi.fn() }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VENTURE: VenturePayload = {
  company_name: 'test-co',
  core_value_proposition: 'test',
  target_audience: 'devs',
  initial_capability_requirements: [],
  estimated_token_cost_ceiling_usd: 10,
};

function makeTask(overrides: Partial<OperatorTask> = {}): OperatorTask {
  return {
    task_id: crypto.randomUUID(),
    company_id: 'co-123',
    role: 'engineering',
    description: 'Build something',
    risk_tier: 'low',
    status: 'completed',
    result: 'done',
    error: null,
    ...overrides,
  };
}

const TASKS: OperatorTask[] = [
  makeTask({ role: 'product' }),
  makeTask({ role: 'engineering' }),
  makeTask({ role: 'customer-success' }),
];

const DONE_REPORT: MonitorReport = {
  company_id: 'co-123',
  cycle: 1,
  friction_points: [],
  diagnosis: 'All good',
  mitigation_type: 'none',
  iteration_complete: true,
  skills_update: null,
};

const CONTINUE_REPORT: MonitorReport = { ...DONE_REPORT, iteration_complete: false };

// ── Setup: temp dir for companyBrain ─────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-graph-'));
  process.env['COMPANIES_DIR'] = path.join(tmpRoot, 'companies');
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env['COMPANIES_DIR'];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── Slice 8: graph orchestration ──────────────────────────────────────────────

describe('runGraph — orchestration (slice 8)', () => {
  it('does not call Idea-Agent when venturePayload is pre-supplied', async () => {
    const { run: ideaRun } = await import('../agents/idea.js');
    const { run: ceoRun } = await import('../agents/ceo.js');
    const { run: opRun } = await import('../agents/operator.js');
    const { run: monRun } = await import('../agents/monitor.js');

    vi.mocked(ceoRun).mockResolvedValue(['co-123', TASKS]);
    vi.mocked(opRun).mockImplementation(async t => t);
    vi.mocked(monRun).mockResolvedValue(DONE_REPORT);

    const { runGraph } = await import('../graph.js');
    await runGraph({ venturePayload: VENTURE });

    expect(ideaRun).not.toHaveBeenCalled();
  });

  it('all operator tasks receive a company_id after running', async () => {
    const { run: ceoRun } = await import('../agents/ceo.js');
    const { run: opRun } = await import('../agents/operator.js');
    const { run: monRun } = await import('../agents/monitor.js');

    vi.mocked(ceoRun).mockResolvedValue(['co-123', TASKS]);
    vi.mocked(opRun).mockImplementation(async t => t);
    vi.mocked(monRun).mockResolvedValue(DONE_REPORT);

    const { runGraph } = await import('../graph.js');
    const state = await runGraph({ venturePayload: VENTURE });

    for (const task of state.operatorTasks) {
      expect(task.company_id).toBeTruthy();
    }
  });

  it('loop exits after one cycle when monitor returns iteration_complete: true', async () => {
    const { run: ceoRun } = await import('../agents/ceo.js');
    const { run: opRun } = await import('../agents/operator.js');
    const { run: monRun } = await import('../agents/monitor.js');

    vi.mocked(ceoRun).mockResolvedValue(['co-123', TASKS]);
    vi.mocked(opRun).mockImplementation(async t => t);
    vi.mocked(monRun).mockResolvedValue(DONE_REPORT);

    const { runGraph } = await import('../graph.js');
    const state = await runGraph({ venturePayload: VENTURE });

    expect(state.cycle).toBe(1);
    expect(state.iterationComplete).toBe(true);
    expect(vi.mocked(monRun)).toHaveBeenCalledTimes(1);
  });

  it('loop caps at DEFAULT_MAX_CYCLES when monitor never completes', async () => {
    const { run: ceoRun } = await import('../agents/ceo.js');
    const { run: opRun } = await import('../agents/operator.js');
    const { run: monRun } = await import('../agents/monitor.js');
    const { DEFAULT_MAX_CYCLES, runGraph } = await import('../graph.js');

    vi.mocked(ceoRun).mockResolvedValue(['co-123', TASKS]);
    vi.mocked(opRun).mockImplementation(async t => t);
    vi.mocked(monRun).mockResolvedValue(CONTINUE_REPORT);

    const state = await runGraph({ venturePayload: VENTURE });

    expect(state.cycle).toBe(DEFAULT_MAX_CYCLES);
    expect(vi.mocked(monRun)).toHaveBeenCalledTimes(DEFAULT_MAX_CYCLES);
  });
});

// ── Quality rework slice 5: loop semantics ────────────────────────────────────

describe('runGraph — maxCycles parameter (F-01)', () => {
  it('caps the loop at the maxCycles passed in the initial state', async () => {
    const { run: ceoRun } = await import('../agents/ceo.js');
    const { run: opRun } = await import('../agents/operator.js');
    const { run: monRun } = await import('../agents/monitor.js');

    vi.mocked(ceoRun).mockResolvedValue(['co-123', TASKS]);
    vi.mocked(opRun).mockImplementation(async t => t);
    vi.mocked(monRun).mockResolvedValue(CONTINUE_REPORT);

    const { runGraph } = await import('../graph.js');
    const state = await runGraph({ venturePayload: VENTURE, maxCycles: 1 });

    expect(state.cycle).toBe(1);
    expect(vi.mocked(monRun)).toHaveBeenCalledTimes(1);
  });
});

describe('runGraph — completed and halted tasks are not re-run (F-07)', () => {
  it('only passes runnable tasks to the operator and preserves the rest', async () => {
    const tasks = [
      makeTask({ role: 'product', status: 'completed' }),
      makeTask({ role: 'engineering', status: 'halted', error: 'Supervisor halt' }),
      makeTask({ role: 'customer-success', status: 'pending', result: null }),
    ];
    const { run: ceoRun } = await import('../agents/ceo.js');
    const { run: opRun } = await import('../agents/operator.js');
    const { run: monRun } = await import('../agents/monitor.js');

    vi.mocked(ceoRun).mockResolvedValue(['co-123', tasks]);
    vi.mocked(opRun).mockImplementation(async t => ({ ...t, status: 'completed' as const }));
    vi.mocked(monRun).mockResolvedValue(DONE_REPORT);

    const { runGraph } = await import('../graph.js');
    const state = await runGraph({ venturePayload: VENTURE });

    expect(vi.mocked(opRun)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(opRun)).toHaveBeenCalledWith(expect.objectContaining({ role: 'customer-success' }));
    expect(state.operatorTasks.find(t => t.role === 'engineering')!.status).toBe('halted');
    expect(state.operatorTasks.find(t => t.role === 'customer-success')!.status).toBe('completed');
    expect(state.operatorTasks).toHaveLength(3);
  });
});
