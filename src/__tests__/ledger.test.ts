import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createLedger, type Ledger } from '../ledger.js';

function makeTempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ledger-'));
  return path.join(dir, 'ledger.db');
}

describe('createLedger — queryEvents', () => {
  let ledger: Ledger;

  beforeEach(() => { ledger = createLedger(makeTempDb()); });
  afterEach(() => { ledger.close(); });

  it('returns all events for a company when no range given', () => {
    ledger.record('co-1', 'task.started', { x: 1 });
    ledger.record('co-1', 'task.completed', { x: 2 });
    expect(ledger.queryEvents('co-1')).toHaveLength(2);
  });

  it('filters events after since id (exclusive)', () => {
    ledger.record('co-1', 'a', {});
    ledger.record('co-1', 'b', {});
    ledger.record('co-1', 'c', {});
    const all = ledger.queryEvents('co-1');
    const firstId = all[0]!.id;
    const rest = ledger.queryEvents('co-1', firstId);
    expect(rest).toHaveLength(2);
    expect(rest[0]!.event_type).toBe('b');
  });

  it('filters events up to until id (inclusive)', () => {
    ledger.record('co-1', 'a', {});
    ledger.record('co-1', 'b', {});
    ledger.record('co-1', 'c', {});
    const all = ledger.queryEvents('co-1');
    const secondId = all[1]!.id;
    const slice = ledger.queryEvents('co-1', undefined, secondId);
    expect(slice).toHaveLength(2);
  });

  it('parses payload as object', () => {
    ledger.record('co-1', 'test', { key: 'value' });
    const rows = ledger.queryEvents('co-1');
    expect((rows[0]!.payload as { key: string }).key).toBe('value');
  });
});

describe('createLedger — tailEvents', () => {
  let ledger: Ledger;

  beforeEach(() => { ledger = createLedger(makeTempDb()); });
  afterEach(() => { ledger.close(); });

  it('delivers pre-existing rows after since=0', async () => {
    ledger.record('co-1', 'a', {});
    ledger.record('co-1', 'b', {});
    const received: unknown[] = [];
    const ctrl = new AbortController();
    ledger.tailEvents('co-1', 0, (r) => received.push(r), ctrl.signal);
    await new Promise(r => setTimeout(r, 50));
    ctrl.abort();
    expect(received).toHaveLength(2);
  });

  it('delivers new rows inserted after tail starts', async () => {
    const received: unknown[] = [];
    const ctrl = new AbortController();
    ledger.tailEvents('co-1', 0, (r) => received.push(r), ctrl.signal);
    await new Promise(r => setTimeout(r, 50));
    ledger.record('co-1', 'late', {});
    await new Promise(r => setTimeout(r, 600));
    ctrl.abort();
    expect(received).toHaveLength(1);
  });

  it('stops delivering rows recorded after abort', async () => {
    const received: unknown[] = [];
    const ctrl = new AbortController();
    ledger.tailEvents('co-1', 0, (r) => received.push(r), ctrl.signal);
    await new Promise(r => setTimeout(r, 50));
    ctrl.abort();
    ledger.record('co-1', 'post-abort', {});
    await new Promise(r => setTimeout(r, 600));
    expect(received).toHaveLength(0);
  });

  it('clears its poll timer on abort (no live timers keep the loop alive)', () => {
    vi.useFakeTimers();
    try {
      const ctrl = new AbortController();
      ledger.tailEvents('co-1', 0, () => {}, ctrl.signal);
      ctrl.abort();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createLedger — queryFailures', () => {
  let ledger: Ledger;

  beforeEach(() => { ledger = createLedger(makeTempDb()); });
  afterEach(() => { ledger.close(); });

  it('records a failure event and queryFailures returns it', () => {
    ledger.record('co-1', 'task.failed', { error: 'oops', success: false });
    const failures = ledger.queryFailures('co-1');
    expect(failures).toHaveLength(1);
    expect(failures[0]!.event_type).toBe('task.failed');
  });

  it('queryFailures filters by company_id', () => {
    ledger.record('co-a', 'task.failed', { success: false });
    ledger.record('co-b', 'task.failed', { success: false });
    expect(ledger.queryFailures('co-a')).toHaveLength(1);
    expect(ledger.queryFailures('co-b')).toHaveLength(1);
  });

  it('non-failure events do NOT appear in queryFailures', () => {
    ledger.record('co-1', 'task.completed', { success: true });
    ledger.record('co-1', 'company.created', { venture: {} });
    expect(ledger.queryFailures('co-1')).toHaveLength(0);
  });

  it('returns empty array for a company with no failures', () => {
    expect(ledger.queryFailures('nonexistent-co')).toEqual([]);
  });

  it('catches human escalation events', () => {
    ledger.record('co-1', 'human.escalation_required', { reason: 'high risk' });
    expect(ledger.queryFailures('co-1')).toHaveLength(1);
  });

  it('catches events with success: false in payload', () => {
    ledger.record('co-1', 'telemetry', { layer: 'tool', success: false });
    expect(ledger.queryFailures('co-1')).toHaveLength(1);
  });

  it('keeps payload keys from clobbering row metadata', () => {
    ledger.record('co-1', 'task.failed', { ts: 'FAKE-TS', event_type: 'FAKE-TYPE', success: false }, 'operator.product');
    const [row] = ledger.queryFailures('co-1');
    expect(row!.event_type).toBe('task.failed');
    expect(row!.ts).not.toBe('FAKE-TS');
    expect(row!.agent_type).toBe('operator.product');
    expect(row!.payload).toMatchObject({ ts: 'FAKE-TS', event_type: 'FAKE-TYPE' });
  });
});

describe('default ledger instance', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-ledger-default-'));
    process.env['COMPANIES_DIR'] = path.join(tmpRoot, 'companies');
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env['COMPANIES_DIR'];
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('record() writes to <COMPANIES_DIR>/ledger.db', async () => {
    const mod = await import('../ledger.js');
    mod.record('co-default', 'task.started', { via: 'default' });
    expect(fs.existsSync(path.join(tmpRoot, 'companies', 'ledger.db'))).toBe(true);
    const direct = mod.createLedger(path.join(tmpRoot, 'companies', 'ledger.db'));
    expect(direct.queryEvents('co-default')).toHaveLength(1);
    direct.close();
  });
});
