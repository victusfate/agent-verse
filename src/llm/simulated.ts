import { FIXTURES } from '../simulation/fixtures.js';
import type { Model, LlmRequestOptions, GenerateResult } from './index.js';

/**
 * SimulatedModel — deterministic canned responses for offline runs and tests.
 * Routing is explicit: callers pass options.fixtureKey (e.g. 'ceo:init',
 * 'product:tool'). Unknown or missing keys throw, so fixture drift is a hard
 * error instead of a silent fallback.
 */
export class SimulatedModel implements Model {
  readonly provider = 'simulated' as const;
  readonly id = 'fixture';

  generate(_systemInstruction: string, _prompt: string, options?: LlmRequestOptions): Promise<GenerateResult> {
    const key = options?.fixtureKey;
    if (!key) {
      return Promise.reject(new Error('SimulatedModel requires options.fixtureKey — the calling agent must pass its fixture key'));
    }
    const fixture = FIXTURES[key];
    if (!fixture) {
      return Promise.reject(new Error(`SimulatedModel has no fixture for key "${key}" — add it to src/simulation/fixtures.ts`));
    }
    return Promise.resolve({ text: fixture });
  }
}
