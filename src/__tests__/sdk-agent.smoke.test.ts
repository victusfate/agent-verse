/**
 * SDK runtime smoke test — skipped unless SDK_AGENT_SMOKE=1 is set.
 * Requires a logged-in local Claude Code install (`claude` on PATH).
 *
 * Run locally:
 *   SDK_AGENT_SMOKE=1 npx vitest run src/__tests__/sdk-agent.smoke.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const skip = process.env['SDK_AGENT_SMOKE'] !== '1';

describe.skipIf(skip)('SDK agent smoke test', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-sdk-smoke-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completes a tool-enabled turn through the local claude binary', async () => {
    const { createModel } = await import('../llm/index.js');
    const model = await createModel('claude-sonnet-4-6', 'sdk');
    expect(model.provider).toBe('sdk');

    const { text, costUsd } = await model.generate(
      'You are the Engineering-Agent. Write the requested file, then respond with ONLY the raw JSON {"done": true} — no prose, no fences.',
      `Create a file named smoke.md in the working directory containing the single line "agent-verse sdk smoke".`,
      {
        session: {
          cwd: tmpDir,
          allowedTools: ['Read', 'Write', 'Glob'],
          maxTurns: 6,
          maxBudgetUsd: 1,
        },
      },
    );

    expect(text.length).toBeGreaterThan(0);
    expect(typeof costUsd).toBe('number');
    expect(fs.readFileSync(path.join(tmpDir, 'smoke.md'), 'utf8')).toContain('agent-verse sdk smoke');
  }, 180_000);
});
