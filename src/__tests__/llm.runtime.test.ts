import { describe, it, expect } from 'vitest';
import { resolveRuntime, assertSdkModel } from '../llm/runtime.js';

describe('resolveRuntime', () => {
  it('auto-falls back to sdk when no key is set and claude is on PATH', () => {
    const runtime = resolveRuntime({ env: {}, claudeOnPath: true });
    expect(runtime).toBe('sdk');
  });

  it('prefers api when an API key is set, even with claude on PATH', () => {
    const runtime = resolveRuntime({ env: { ANTHROPIC_API_KEY: 'sk-test' }, claudeOnPath: true });
    expect(runtime).toBe('api');
  });

  it('defaults to api when claude is not on PATH', () => {
    const runtime = resolveRuntime({ env: {}, claudeOnPath: false });
    expect(runtime).toBe('api');
  });

  it('lets AGENT_RUNTIME override auto-fallback', () => {
    const runtime = resolveRuntime({
      env: { AGENT_RUNTIME: 'api' },
      claudeOnPath: true,
    });
    expect(runtime).toBe('api');
  });

  it('lets the explicit flag beat AGENT_RUNTIME', () => {
    const runtime = resolveRuntime({
      flag: 'sdk',
      env: { AGENT_RUNTIME: 'api', ANTHROPIC_API_KEY: 'sk-test' },
      claudeOnPath: false,
    });
    expect(runtime).toBe('sdk');
  });

  it('rejects an invalid AGENT_RUNTIME value at the boundary', () => {
    expect(() => resolveRuntime({ env: { AGENT_RUNTIME: 'cloud' } }))
      .toThrow(/AGENT_RUNTIME.*'cloud'/);
  });
});

describe('assertSdkModel', () => {
  it('accepts Claude model ids', () => {
    expect(() => assertSdkModel('claude-sonnet-4-6')).not.toThrow();
    expect(() => assertSdkModel('anthropic/claude-opus-4-8')).not.toThrow();
  });

  it('rejects non-Claude model ids under the sdk runtime', () => {
    expect(() => assertSdkModel('gpt-4o-mini'))
      .toThrow(/sdk runtime.*Claude.*gpt-4o-mini/s);
  });
});
