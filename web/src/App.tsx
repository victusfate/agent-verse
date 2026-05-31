import { useState, useEffect, useRef } from 'react';
import { LiveFeed } from './components/LiveFeed.js';
import { Scrubber } from './components/Scrubber.js';
import { DrillDown } from './components/DrillDown.js';
import { LedgerExplorer } from './components/LedgerExplorer.js';
import type { LedgerRow, Playhead } from './types.js';

const API = '';

export function App() {
  const [companyId, setCompanyId] = useState('');
  const [allEvents, setAllEvents] = useState<LedgerRow[]>([]);
  const [visibleEvents, setVisibleEvents] = useState<LedgerRow[]>([]);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [playhead, setPlayhead] = useState<Playhead>({ state: 'playing', eventIndex: 0 });
  const [tab, setTab] = useState<'live' | 'venture' | 'ledger'>('live');
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!companyId) return;
    esRef.current?.close();
    const es = new EventSource(`${API}/events/stream?company_id=${companyId}`);
    es.onmessage = (e) => {
      const row = JSON.parse(e.data) as LedgerRow;
      setAllEvents(prev => [...prev, row]);
    };
    esRef.current = es;
    return () => es.close();
  }, [companyId]);

  useEffect(() => {
    if (playhead.state === 'playing') {
      setVisibleEvents(allEvents);
      setPlayhead(p => ({ ...p, eventIndex: allEvents.length }));
    }
  }, [allEvents, playhead.state]);

  const seek = (index: number) => {
    setPlayhead({ state: 'paused', eventIndex: index });
    setVisibleEvents(allEvents.slice(0, index));
  };

  return (
    <div data-testid="app">
      <header>
        <h1>Agent-Verse Dashboard</h1>
        <input
          data-testid="company-input"
          placeholder="Company ID"
          value={companyId}
          onChange={e => setCompanyId(e.target.value)}
        />
      </header>

      <Scrubber
        total={allEvents.length}
        playhead={playhead}
        onPlay={() => setPlayhead(p => ({ ...p, state: 'playing' }))}
        onPause={() => setPlayhead(p => ({ ...p, state: 'paused' }))}
        onSeek={seek}
      />

      <nav>
        <button data-testid="tab-live" onClick={() => setTab('live')}>Live Feed</button>
        <button data-testid="tab-venture" onClick={() => setTab('venture')}>Venture View</button>
        <button data-testid="tab-ledger" onClick={() => setTab('ledger')}>Ledger Explorer</button>
      </nav>

      {tab === 'live' && <LiveFeed events={visibleEvents} onSelect={setSelected} />}
      {tab === 'ledger' && <LedgerExplorer events={allEvents} onSelect={setSelected} />}
      {tab === 'venture' && (
        <section data-testid="venture-tab">
          <p>Enter a company ID above to view venture details.</p>
        </section>
      )}

      <DrillDown event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
