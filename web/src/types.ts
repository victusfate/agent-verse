export interface LedgerRow {
  id: number;
  ts: string;
  company_id: string;
  event_type: string;
  agent_type: string | null;
  payload: Record<string, unknown>;
}

export type PlaybackState = 'playing' | 'paused';

export interface Playhead {
  state: PlaybackState;
  eventIndex: number;
}
