import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../cliArgs.js';

const VENTURE_JSON = JSON.stringify({
  company_name: 'pdf-ocr-api',
  core_value_proposition: 'OCR as a service',
  target_audience: 'devs',
  initial_capability_requirements: ['ocr'],
  estimated_token_cost_ceiling_usd: 25,
});

describe('parseCliArgs', () => {
  it('parses model, provider, and seed', () => {
    const args = parseCliArgs(['--model', 'gpt-4o-mini', '--provider', 'openai', '--seed', 'invoice tool']);
    expect(args.model).toBe('gpt-4o-mini');
    expect(args.provider).toBe('openai');
    expect(args.seed).toBe('invoice tool');
  });

  it('rejects unknown flags', () => {
    expect(() => parseCliArgs(['--bogus', 'x'])).toThrow();
  });

  it('parses --runtime sdk and api', () => {
    expect(parseCliArgs(['--runtime', 'sdk']).runtime).toBe('sdk');
    expect(parseCliArgs(['--runtime', 'api']).runtime).toBe('api');
    expect(parseCliArgs([]).runtime).toBeUndefined();
  });

  it('rejects an invalid --runtime value at the boundary', () => {
    expect(() => parseCliArgs(['--runtime', 'cloud'])).toThrow(/--runtime.*'cloud'/);
  });

  it('rejects --seed without a value instead of treating it as boolean true', () => {
    expect(() => parseCliArgs(['--seed'])).toThrow();
  });

  it('parses and validates a --venture payload', () => {
    const args = parseCliArgs(['--venture', VENTURE_JSON]);
    expect(args.venture?.company_name).toBe('pdf-ocr-api');
    expect(args.venture?.estimated_token_cost_ceiling_usd).toBe(25);
  });

  it('fails with a clear error on malformed --venture JSON', () => {
    expect(() => parseCliArgs(['--venture', '{not json'])).toThrow(/--venture/);
  });

  it('fails with a clear error when --venture JSON has the wrong shape', () => {
    expect(() => parseCliArgs(['--venture', '{"company_name": 42}'])).toThrow(/--venture/);
  });

  it('parses --max-cycles as a positive integer', () => {
    expect(parseCliArgs(['--max-cycles', '2']).maxCycles).toBe(2);
  });

  it('rejects a non-numeric --max-cycles', () => {
    expect(() => parseCliArgs(['--max-cycles', 'abc'])).toThrow(/--max-cycles/);
  });

  it('returns null venture and undefined maxCycles when not provided', () => {
    const args = parseCliArgs([]);
    expect(args.venture).toBeNull();
    expect(args.maxCycles).toBeUndefined();
  });
});
