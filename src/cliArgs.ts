/**
 * CLI argument parsing for the main entry point.
 * Strict: unknown flags and missing values fail at the boundary with clear errors.
 */
import { parseArgs } from 'node:util';
import { VenturePayloadSchema, type VenturePayload } from './schemas.js';
import { parseRuntime, type AgentRuntime } from './llm/runtime.js';

export interface CliArgs {
  seed?: string;
  model?: string;
  provider?: string;
  runtime?: AgentRuntime;
  venture: VenturePayload | null;
  maxCycles?: number;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      seed:         { type: 'string' },
      venture:      { type: 'string' },
      model:        { type: 'string' },
      provider:     { type: 'string' },
      runtime:      { type: 'string' },
      'max-cycles': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });

  let venture: VenturePayload | null = null;
  if (values.venture !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(values.venture);
    } catch {
      throw new Error(`--venture is not valid JSON: ${values.venture.slice(0, 80)}`);
    }
    const result = VenturePayloadSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`--venture does not match the venture payload schema:\n${result.error.message}`);
    }
    venture = result.data;
  }

  const runtime: AgentRuntime | undefined =
    values.runtime !== undefined ? parseRuntime(values.runtime, '--runtime') : undefined;

  let maxCycles: number | undefined;
  if (values['max-cycles'] !== undefined) {
    const n = Number(values['max-cycles']);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--max-cycles must be a positive integer, got '${values['max-cycles']}'`);
    }
    maxCycles = n;
  }

  return {
    ...(values.seed !== undefined ? { seed: values.seed } : {}),
    ...(values.model !== undefined ? { model: values.model } : {}),
    ...(values.provider !== undefined ? { provider: values.provider } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
    venture,
    ...(maxCycles !== undefined ? { maxCycles } : {}),
  };
}
