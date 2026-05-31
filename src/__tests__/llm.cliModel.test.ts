import { describe, it, expect } from 'vitest';
import { CliModel } from '../llm/cli.js';

describe('CliModel — subprocess round-trip', () => {
  it('returns stdout from a cat round-trip', async () => {
    const model = new CliModel('cat');
    const result = await model.generate('system', 'hello world');
    expect(result).toContain('hello world');
  });

  it('exposes provider as cli', () => {
    const model = new CliModel('echo');
    expect(model.provider).toBe('cli');
  });

  it('exposes id as the command string', () => {
    const model = new CliModel('echo');
    expect(model.id).toBe('echo');
  });
});

// ops-hardening slice 6: DEBT-4
describe('CliModel — quoted argument parsing', () => {
  it('passes quoted arguments with spaces as a single token (DEBT-4)', async () => {
    // sh -c "echo hello" should produce "hello", not fail with broken quoting
    const model = new CliModel('sh -c "echo hello"');
    const result = await model.generate('system', 'prompt');
    expect(result).toContain('hello');
  });
});

describe('CliModel — ANSI stripping', () => {
  it('strips ANSI escape codes from output', async () => {
    const model = new CliModel('cat');
    const result = await model.generate('system', '\x1B[32mgreen text\x1B[0m');
    expect(result).not.toMatch(/\x1B\[/);
    expect(result).toContain('green text');
  });
});

describe('CliModel — error handling', () => {
  it('throws when subprocess exits with non-zero code', async () => {
    const model = new CliModel('sh');
    await expect(model.generate('system', '-c "exit 1"')).rejects.toThrow();
  });

  it('throws on timeout', async () => {
    const model = new CliModel('sleep 10', 100);
    await expect(model.generate('system', 'prompt')).rejects.toThrow(/timeout/i);
  }, 3000);
});

describe('CliModel — factory detection', () => {
  it('detectProvider returns cli for cli: prefix', async () => {
    const { detectProvider } = await import('../llm/index.js');
    expect(detectProvider('cli:claude')).toBe('cli');
  });

  it('createModel returns CliModel for cli: prefix', async () => {
    const { createModel } = await import('../llm/index.js');
    const model = await createModel('cli:echo');
    expect(model.provider).toBe('cli');
  });
});
