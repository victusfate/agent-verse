import { FIXTURES, FALLBACK } from '../simulation/fixtures.js';
import type { Model, LlmRequestOptions, GenerateResult } from './index.js';

const ROLE_KEYWORDS: [string, string][] = [
  ['Product-Agent', 'product'],
  ['Engineering-Agent', 'engineering'],
  ['Customer-Success-Agent', 'customer-success'],
  ['Supervisor', 'supervisor'],
  ['Monitor', 'monitor'],
  ['Idea-Agent', 'idea'],
  ['CEO-Agent', 'ceo'],
];

const LAYER_KEYWORDS: [string, string][] = [
  ['Policy-Layer', 'policy'],
  ['Execute this task', 'tool'],
  ['Evaluate this task', 'policy'],
  ['diagnos', 'diagnose'],
  ['Generate a venture', 'generate'],
  ['Initialize the company', 'init'],
];

function resolveKey(systemInstruction: string, prompt: string): string {
  const combined = `${systemInstruction} ${prompt}`;
  let role = 'unknown';
  let layer = 'tool';

  for (const [kw, r] of ROLE_KEYWORDS) {
    if (combined.includes(kw)) { role = r; break; }
  }
  for (const [kw, l] of LAYER_KEYWORDS) {
    if (combined.includes(kw)) { layer = l; break; }
  }

  return `${role}:${layer}`;
}

export class SimulatedModel implements Model {
  readonly provider = 'simulated' as const;
  readonly id = 'fixture';

  generate(systemInstruction: string, prompt: string, _options?: LlmRequestOptions): Promise<GenerateResult> {
    const key = resolveKey(systemInstruction, prompt);
    const fixture = FIXTURES[key];

    if (!fixture) {
      process.stderr.write(`[SimulatedModel] No fixture for key "${key}" — using fallback\n`);
      return Promise.resolve({ text: FALLBACK });
    }

    return Promise.resolve({ text: fixture });
  }
}
