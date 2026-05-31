import type { LedgerRow } from '../types.js';

interface Props {
  events: LedgerRow[];
  onSelect: (event: LedgerRow) => void;
}

export function LiveFeed({ events, onSelect }: Props) {
  return (
    <section data-testid="live-feed">
      <h2>Live Feed</h2>
      <ul>
        {events.map(ev => (
          <li
            key={ev.id}
            data-testid="feed-row"
            onClick={() => onSelect(ev)}
            onDoubleClick={() => onSelect(ev)}
            style={{ cursor: 'pointer' }}
          >
            <span data-testid="event-ts">{ev.ts}</span>
            {' '}
            <span data-testid="event-type">{ev.event_type}</span>
            {' '}
            <span data-testid="event-agent">{ev.agent_type ?? '—'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
