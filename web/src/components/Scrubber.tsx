import type { Playhead } from '../types.js';

interface Props {
  total: number;
  playhead: Playhead;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (index: number) => void;
}

export function Scrubber({ total, playhead, onPlay, onPause, onSeek }: Props) {
  return (
    <div data-testid="scrubber">
      <button
        data-testid="btn-play"
        onClick={onPlay}
        disabled={playhead.state === 'playing'}
      >
        Play
      </button>
      <button
        data-testid="btn-pause"
        onClick={onPause}
        disabled={playhead.state === 'paused'}
      >
        Pause
      </button>
      <button data-testid="btn-rewind" onClick={() => onSeek(0)}>
        Rewind
      </button>
      <input
        data-testid="seek-bar"
        type="range"
        min={0}
        max={total}
        value={playhead.eventIndex}
        onChange={e => onSeek(Number(e.target.value))}
      />
      <span data-testid="playhead-pos">{playhead.eventIndex} / {total}</span>
    </div>
  );
}
