import { useState } from 'react';
import type { LedgerRow } from '../types.js';

interface Props {
  event: LedgerRow | null;
  onClose: () => void;
}

const LAYERS = ['sensor', 'policy', 'supervisor', 'tool', 'quality_gate', 'learning'] as const;

export function DrillDown({ event, onClose }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  if (!event) return null;

  const layers = LAYERS.filter(l => l in (event.payload as Record<string, unknown>));

  return (
    <aside data-testid="drill-down">
      <button data-testid="btn-close" onClick={onClose}>✕</button>
      <h3 data-testid="dd-event-type">{event.event_type}</h3>
      <p data-testid="dd-ts">{event.ts}</p>

      {layers.length > 0 ? (
        <ul>
          {layers.map(layer => (
            <li key={layer} data-testid={`layer-${layer}`}>
              <strong>{layer}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="dd-no-layers">No layer breakdown available</p>
      )}

      <button data-testid="btn-toggle-raw" onClick={() => setShowRaw(s => !s)}>
        {showRaw ? 'Hide' : 'Show'} raw JSON
      </button>
      {showRaw && (
        <pre data-testid="raw-json">{JSON.stringify(event.payload, null, 2)}</pre>
      )}
    </aside>
  );
}
