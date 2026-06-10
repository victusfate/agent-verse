import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { App } from '../App.js';
import type { LedgerRow } from '../types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() { this.closed = true; }

  emit(row: LedgerRow) {
    this.onmessage?.({ data: JSON.stringify(row) });
  }
}

const fetchMock = vi.fn();

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'co-1',
      context: { mission: 'Automate everything', cycle: 2 },
      skills: '# Skills\n- ship',
      tasks: [{ taskId: 't-1', task: { task_id: 't-1', role: 'product', status: 'completed', description: 'spec' } }],
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeRow(id: number): LedgerRow {
  return { id, ts: `2026-01-01T00:0${id}:00Z`, company_id: 'co-1', event_type: `event.${id}`, agent_type: null, payload: {} };
}

function commitCompany(id: string) {
  const input = screen.getByTestId('company-input');
  fireEvent.change(input, { target: { value: id } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

// ── Entry point (F-04) ────────────────────────────────────────────────────────

describe('web entry point', () => {
  it('has index.html and main.tsx so vite can serve the app', () => {
    const webRoot = path.resolve(__dirname, '..', '..');
    expect(fs.existsSync(path.join(webRoot, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(webRoot, 'src', 'main.tsx'))).toBe(true);
  });
});

// ── EventSource lifecycle (F-18) ──────────────────────────────────────────────

describe('App — EventSource lifecycle', () => {
  it('opens a single EventSource only when the company id is committed', () => {
    render(<App />);
    const input = screen.getByTestId('company-input');
    fireEvent.change(input, { target: { value: 'c' } });
    fireEvent.change(input, { target: { value: 'co' } });
    fireEvent.change(input, { target: { value: 'co-1' } });
    expect(MockEventSource.instances).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toContain('company_id=co-1');
  });

  it('URL-encodes the company id', () => {
    render(<App />);
    commitCompany('weird co/1');
    expect(MockEventSource.instances[0]!.url).toContain(encodeURIComponent('weird co/1'));
  });
});

// ── Company switch resets state (F-12) ────────────────────────────────────────

describe('App — switching companies', () => {
  it('clears the previous company events and closes its stream', () => {
    render(<App />);
    commitCompany('co-1');
    const first = MockEventSource.instances[0]!;
    act(() => { first.emit(makeRow(1)); first.emit(makeRow(2)); });
    expect(screen.getAllByTestId('feed-row')).toHaveLength(2);

    commitCompany('co-2');
    expect(first.closed).toBe(true);
    expect(screen.queryAllByTestId('feed-row')).toHaveLength(0);
  });
});

// ── Derived visible events + scrubber bounds (F-17, F-28) ─────────────────────

describe('App — playhead and visible events', () => {
  it('derives visible events from the playhead instead of mirroring state', () => {
    render(<App />);
    commitCompany('co-1');
    const es = MockEventSource.instances[0]!;
    act(() => { es.emit(makeRow(1)); es.emit(makeRow(2)); es.emit(makeRow(3)); });
    expect(screen.getAllByTestId('feed-row')).toHaveLength(3);

    fireEvent.click(screen.getByTestId('btn-pause'));
    fireEvent.change(screen.getByTestId('seek-bar'), { target: { value: '1' } });
    expect(screen.getAllByTestId('feed-row')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('btn-play'));
    expect(screen.getAllByTestId('feed-row')).toHaveLength(3);
  });

  it('the scrubber can reach the last event', () => {
    render(<App />);
    commitCompany('co-1');
    const es = MockEventSource.instances[0]!;
    act(() => { es.emit(makeRow(1)); es.emit(makeRow(2)); });

    fireEvent.click(screen.getByTestId('btn-pause'));
    const slider = screen.getByTestId('seek-bar') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(screen.getAllByTestId('feed-row')).toHaveLength(2);
  });
});

// ── Venture tab (F-27) ────────────────────────────────────────────────────────

describe('App — venture tab', () => {
  it('fetches and renders venture data for the committed company', async () => {
    render(<App />);
    commitCompany('co-1');
    fireEvent.click(screen.getByTestId('tab-venture'));

    expect(await screen.findByTestId('venture-view')).toBeInTheDocument();
    expect(screen.getByTestId('mission')).toHaveTextContent('Automate everything');
    expect(screen.getAllByTestId('task-card')).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/companies/co-1'));
  });
});
