/**
 * CLI agent smoke test — skipped in CI unless CLI_AGENT_CMD is set.
 *
 * Run locally:
 *   CLI_AGENT_CMD=claude npm run test:cli-agent
 *   CLI_AGENT_CMD="cat" npm run test:cli-agent   # quick sanity check with cat
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const CLI_CMD = process.env['CLI_AGENT_CMD'];
const skip = !CLI_CMD;

describe.skipIf(skip)('CLI agent smoke test', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-cli-smoke-'));
    process.env['COMPANIES_DIR'] = path.join(tmpDir, 'companies');
    fs.mkdirSync(path.join(tmpDir, 'companies', 'smoke-co'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'companies', 'smoke-co', 'context_framework.json'),
      JSON.stringify({ mission: 'Smoke test', token_budget_usd: 5, tokens_consumed_usd: 0 }),
    );
    fs.writeFileSync(path.join(tmpDir, 'companies', 'smoke-co', 'skills.md'), '# Skills\n');
  });

  afterEach(() => {
    delete process.env['COMPANIES_DIR'];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completes or fails a task end-to-end via the CLI agent', async () => {
    const { createModel } = await import('../llm/index.js');
    const model = await createModel(`cli:${CLI_CMD}`);
    expect(model.provider).toBe('cli');

    const { text: result } = await model.generate(
      'You are the Engineering-Agent. Respond with a JSON object.',
      JSON.stringify({
        deliverable: 'Describe a REST API design in one sentence.',
        artifacts: [],
        confidence: 0.8,
        next_actions: [],
      }),
    );

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  }, 120_000);
});
