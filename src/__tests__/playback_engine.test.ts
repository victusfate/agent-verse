import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import * as playbackEngine from '../services/playback_engine.js';

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-playback-'));
  return path.join(dir, 'ledger.db');
}

describe('playback_engine', () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = makeTempDb();
    playbackEngine.setDbPath(tempDbPath);
  });

  afterEach(() => {
    playbackEngine.closeDb();
    try {
      if (fs.existsSync(path.dirname(tempDbPath))) {
        fs.rmSync(path.dirname(tempDbPath), { recursive: true, force: true });
      }
    } catch (err) {
      // Ignore teardown lock issues in temp dir
    }
  });

  const mockSnapshot: playbackEngine.SimulationSnapshot = {
    step_index: 1,
    timestamp: new Date().toISOString(),
    company_id: 'test-co',
    git_sha: 'abc1234',
    code_diff: 'export const x = 1;',
    seed_prompt: 'financial platform',
    inputs: {
      eventId: 'ev_123',
      type: 'FINANCIAL_CALCULATION',
      payload: { value: 42 }
    },
    system_state: {
      activeCompanyId: 'test-co',
      activeAgent: 'Operator-Agents',
      currentIteration: 1,
      totalCost: 0.15,
      budgetCeiling: 50.00,
      discountRate: 0.1,
      paymentAmount: 100,
      humanApprovalQueue: [],
      hasPatchedCode: false
    },
    outputs: {
      status: 'SUCCESS',
      netProfit: 1000
    }
  };

  it('appends and reads a snapshot successfully', () => {
    playbackEngine.appendSnapshot(mockSnapshot);
    const snapshot = playbackEngine.readSnapshot(1);
    
    expect(snapshot).not.toBeNull();
    expect(snapshot!.step_index).toBe(1);
    expect(snapshot!.company_id).toBe('test-co');
    expect(snapshot!.git_sha).toBe('abc1234');
    expect(snapshot!.inputs.eventId).toBe('ev_123');
    expect(snapshot!.system_state.budgetCeiling).toBe(50.00);
    expect(snapshot!.outputs.status).toBe('SUCCESS');
  });

  it('retrieves all snapshots in step order', () => {
    playbackEngine.appendSnapshot({ ...mockSnapshot, step_index: 2 });
    playbackEngine.appendSnapshot({ ...mockSnapshot, step_index: 1 });

    const all = playbackEngine.getAllSnapshots();
    expect(all).toHaveLength(2);
    expect(all[0].step_index).toBe(1);
    expect(all[1].step_index).toBe(2);
  });

  it('filters all snapshots by companyId', () => {
    playbackEngine.appendSnapshot({ ...mockSnapshot, step_index: 1, company_id: 'co-a' });
    playbackEngine.appendSnapshot({ ...mockSnapshot, step_index: 2, company_id: 'co-b' });

    expect(playbackEngine.getAllSnapshots('co-a')).toHaveLength(1);
    expect(playbackEngine.getAllSnapshots('co-a')[0].step_index).toBe(1);
    expect(playbackEngine.getAllSnapshots('co-b')).toHaveLength(1);
    expect(playbackEngine.getAllSnapshots('co-b')[0].step_index).toBe(2);
  });

  it('clears all simulation history successfully', () => {
    playbackEngine.appendSnapshot(mockSnapshot);
    expect(playbackEngine.getAllSnapshots()).toHaveLength(1);

    playbackEngine.clearHistory();
    expect(playbackEngine.getAllSnapshots()).toHaveLength(0);
  });
});
