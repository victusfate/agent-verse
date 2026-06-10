import { useState, useEffect } from 'react';
import { LiveFeed } from './components/LiveFeed.js';
import { Scrubber } from './components/Scrubber.js';
import { DrillDown } from './components/DrillDown.js';
import { LedgerExplorer } from './components/LedgerExplorer.js';
import { VentureView } from './components/VentureView.js';
import type { LedgerRow, Playhead } from './types.js';

const API = '';

interface VentureTask {
  task_id: string;
  role: string;
  status: string;
  description: string;
}

interface VentureData {
  id: string;
  context: Record<string, unknown>;
  skills: string;
  tasks: Array<{ taskId?: string; task?: VentureTask }>;
}

export function App() {
  const [draftId, setDraftId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [allEvents, setAllEvents] = useState<LedgerRow[]>([]);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [playhead, setPlayhead] = useState<Playhead>({ state: 'playing', eventIndex: 0 });
  const [tab, setTab] = useState<'live' | 'venture' | 'ledger'>('live');
  const [venture, setVenture] = useState<VentureData | null>(null);
  const [streamError, setStreamError] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    const es = new EventSource(`${API}/events/stream?company_id=${encodeURIComponent(companyId)}`);
    es.onmessage = (e) => {
      const row = JSON.parse(e.data) as LedgerRow;
      setAllEvents(prev => [...prev, row]);
    };
    es.onerror = () => {
      setStreamError(true);
      es.close();
    };
    return () => es.close();
  }, [companyId]);

  useEffect(() => {
    if (!companyId || tab !== 'venture') return;
    let cancelled = false;
    fetch(`${API}/companies/${encodeURIComponent(companyId)}`)
      .then(r => (r.ok ? (r.json() as Promise<VentureData>) : null))
      .then(data => { if (!cancelled) setVenture(data); })
      .catch(() => { if (!cancelled) setVenture(null); });
    return () => { cancelled = true; };
  }, [companyId, tab]);

  const commitCompany = () => {
    if (draftId === companyId) return;
    setCompanyId(draftId);
    setAllEvents([]);
    setSelected(null);
    setVenture(null);
    setStreamError(false);
    setPlayhead({ state: 'playing', eventIndex: 0 });
  };

  // Visible events are derived from the playhead — never mirrored in state.
  const visibleEvents = playhead.state === 'playing'
    ? allEvents
    : allEvents.slice(0, playhead.eventIndex);
  const playheadIndex = playhead.state === 'playing' ? allEvents.length : playhead.eventIndex;

  return (
    <div data-testid="app">
      <header>
        <h1>Agent-Verse Dashboard</h1>
        <input
          data-testid="company-input"
          placeholder="Company ID (press Enter)"
          value={draftId}
          onChange={e => setDraftId(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitCompany(); }}
          onBlur={commitCompany}
        />
        {streamError && <span data-testid="stream-status">event stream disconnected</span>}
      </header>

      <Scrubber
        total={allEvents.length}
        playhead={{ ...playhead, eventIndex: playheadIndex }}
        onPlay={() => setPlayhead({ state: 'playing', eventIndex: allEvents.length })}
        onPause={() => setPlayhead({ state: 'paused', eventIndex: allEvents.length })}
        onSeek={i => setPlayhead({ state: 'paused', eventIndex: i })}
      />

      <nav>
        <button data-testid="tab-live" onClick={() => setTab('live')}>Live Feed</button>
        <button data-testid="tab-venture" onClick={() => setTab('venture')}>Venture View</button>
        <button data-testid="tab-ledger" onClick={() => setTab('ledger')}>Ledger Explorer</button>
      </nav>

      {tab === 'live' && <LiveFeed events={visibleEvents} onSelect={setSelected} />}
      {tab === 'ledger' && <LedgerExplorer events={allEvents} onSelect={setSelected} />}
      {tab === 'venture' && (
        venture ? (
          <VentureView
            companyId={venture.id}
            mission={String(venture.context['mission'] ?? '')}
            cycle={Number(venture.context['cycle'] ?? 0)}
            tasks={venture.tasks.map(t => t.task).filter((t): t is VentureTask => Boolean(t))}
            skills={venture.skills}
          />
        ) : (
          <section data-testid="venture-tab">
            <p>{companyId ? 'Loading venture details…' : 'Enter a company ID above to view venture details.'}</p>
          </section>
        )
      )}

      <DrillDown event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
