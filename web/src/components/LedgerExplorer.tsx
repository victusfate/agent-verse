import { useState } from 'react';
import type { LedgerRow } from '../types.js';

interface Props {
  events: LedgerRow[];
  onSelect: (event: LedgerRow) => void;
}

export function LedgerExplorer({ events, onSelect }: Props) {
  const [filter, setFilter] = useState('');

  const filtered = filter
    ? events.filter(ev =>
        ev.event_type.includes(filter) ||
        (ev.agent_type ?? '').includes(filter) ||
        ev.company_id.includes(filter),
      )
    : events;

  return (
    <section data-testid="ledger-explorer">
      <h2>Ledger Explorer</h2>
      <input
        data-testid="filter-input"
        placeholder="Filter by event type, agent, or company"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <span data-testid="row-count">{filtered.length} events</span>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Timestamp</th><th>Company</th><th>Event</th><th>Agent</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(ev => (
            <tr
              key={ev.id}
              data-testid="ledger-row"
              onClick={() => onSelect(ev)}
              style={{ cursor: 'pointer' }}
            >
              <td>{ev.id}</td>
              <td>{ev.ts}</td>
              <td>{ev.company_id}</td>
              <td data-testid="ledger-event-type">{ev.event_type}</td>
              <td>{ev.agent_type ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
