import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LiveFeed } from '../components/LiveFeed.js';
import { Scrubber } from '../components/Scrubber.js';
import { DrillDown } from '../components/DrillDown.js';
import { LedgerExplorer } from '../components/LedgerExplorer.js';
import type { LedgerRow, Playhead } from '../types.js';

const ev1: LedgerRow = { id: 1, ts: '2026-01-01T00:00:00Z', company_id: 'co-1', event_type: 'task.started', agent_type: 'operator.engineering', payload: {} };
const ev2: LedgerRow = { id: 2, ts: '2026-01-01T00:01:00Z', company_id: 'co-1', event_type: 'task.completed', agent_type: 'operator.product', payload: { result: 'done' } };

// ── LiveFeed ──────────────────────────────────────────────────────────────────

describe('LiveFeed', () => {
  it('renders without crashing when events is empty', () => {
    render(<LiveFeed events={[]} onSelect={vi.fn()} />);
    expect(screen.getByTestId('live-feed')).toBeInTheDocument();
  });

  it('renders one row per event', () => {
    render(<LiveFeed events={[ev1, ev2]} onSelect={vi.fn()} />);
    expect(screen.getAllByTestId('feed-row')).toHaveLength(2);
  });

  it('displays event_type in each row', () => {
    render(<LiveFeed events={[ev1]} onSelect={vi.fn()} />);
    expect(screen.getByTestId('event-type')).toHaveTextContent('task.started');
  });

  it('calls onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<LiveFeed events={[ev1]} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('feed-row'));
    expect(onSelect).toHaveBeenCalledWith(ev1);
  });
});

// ── Scrubber ──────────────────────────────────────────────────────────────────

describe('Scrubber', () => {
  const paused: Playhead = { state: 'paused', eventIndex: 2 };
  const playing: Playhead = { state: 'playing', eventIndex: 5 };

  it('renders play, pause, and rewind buttons', () => {
    render(<Scrubber total={10} playhead={paused} onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} />);
    expect(screen.getByTestId('btn-play')).toBeInTheDocument();
    expect(screen.getByTestId('btn-pause')).toBeInTheDocument();
    expect(screen.getByTestId('btn-rewind')).toBeInTheDocument();
  });

  it('play button is disabled when state is playing', () => {
    render(<Scrubber total={10} playhead={playing} onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} />);
    expect(screen.getByTestId('btn-play')).toBeDisabled();
  });

  it('pause button is disabled when state is paused', () => {
    render(<Scrubber total={10} playhead={paused} onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} />);
    expect(screen.getByTestId('btn-pause')).toBeDisabled();
  });

  it('rewind calls onSeek(0)', () => {
    const onSeek = vi.fn();
    render(<Scrubber total={10} playhead={paused} onPlay={vi.fn()} onPause={vi.fn()} onSeek={onSeek} />);
    fireEvent.click(screen.getByTestId('btn-rewind'));
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('displays current playhead position', () => {
    render(<Scrubber total={10} playhead={paused} onPlay={vi.fn()} onPause={vi.fn()} onSeek={vi.fn()} />);
    expect(screen.getByTestId('playhead-pos')).toHaveTextContent('2 / 10');
  });
});

// ── DrillDown ─────────────────────────────────────────────────────────────────

describe('DrillDown', () => {
  it('renders nothing when event is null', () => {
    const { container } = render(<DrillDown event={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows event_type and ts when event is provided', () => {
    render(<DrillDown event={ev1} onClose={vi.fn()} />);
    expect(screen.getByTestId('dd-event-type')).toHaveTextContent('task.started');
    expect(screen.getByTestId('dd-ts')).toHaveTextContent('2026-01-01');
  });

  it('shows raw JSON when toggle is clicked', () => {
    render(<DrillDown event={ev2} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('btn-toggle-raw'));
    expect(screen.getByTestId('raw-json')).toHaveTextContent('result');
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<DrillDown event={ev1} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('btn-close'));
    expect(onClose).toHaveBeenCalled();
  });
});

// ── LedgerExplorer ────────────────────────────────────────────────────────────

describe('LedgerExplorer', () => {
  it('renders all events by default', () => {
    render(<LedgerExplorer events={[ev1, ev2]} onSelect={vi.fn()} />);
    expect(screen.getAllByTestId('ledger-row')).toHaveLength(2);
  });

  it('filters events by event type when filter text is entered', () => {
    render(<LedgerExplorer events={[ev1, ev2]} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByTestId('filter-input'), { target: { value: 'completed' } });
    expect(screen.getAllByTestId('ledger-row')).toHaveLength(1);
    expect(screen.getByTestId('ledger-event-type')).toHaveTextContent('task.completed');
  });

  it('shows correct row count', () => {
    render(<LedgerExplorer events={[ev1, ev2]} onSelect={vi.fn()} />);
    expect(screen.getByTestId('row-count')).toHaveTextContent('2 events');
  });

  it('calls onSelect when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<LedgerExplorer events={[ev1]} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('ledger-row'));
    expect(onSelect).toHaveBeenCalledWith(ev1);
  });
});
