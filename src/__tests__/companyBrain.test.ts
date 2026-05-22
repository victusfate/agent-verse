import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// We need companyBrain to write into a temp directory, not the real `companies/`.
// The module hard-codes `companies/` as the base. We'll override via chdir.
let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-brain-'));
  process.chdir(tmpRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// Dynamic import inside each test so the module uses the CWD set above.
async function getBrain() {
  const { writeContextFramework, readContextFramework, writeSkills, readSkills } =
    await import('../companyBrain.js');
  return { writeContextFramework, readContextFramework, writeSkills, readSkills };
}

describe('companyBrain', () => {
  it('context framework round-trips correctly', async () => {
    const { writeContextFramework, readContextFramework } = await getBrain();
    const ctx = { mission: 'Ship fast', budget: 50, nested: { a: 1 } };
    writeContextFramework('test-co', ctx);
    expect(readContextFramework('test-co')).toEqual(ctx);
  });

  it('skills round-trips correctly', async () => {
    const { writeSkills, readSkills } = await getBrain();
    const md = '# Skills\n\n- Do things\n- Do more things\n';
    writeSkills('test-co', md);
    expect(readSkills('test-co')).toBe(md);
  });

  it('readContextFramework returns {} for missing company', async () => {
    const { readContextFramework } = await getBrain();
    expect(readContextFramework('no-such-company')).toEqual({});
  });

  it('readSkills returns empty string for missing company', async () => {
    const { readSkills } = await getBrain();
    expect(readSkills('no-such-company')).toBe('');
  });

  it('writeContextFramework creates intermediate directories', async () => {
    const { writeContextFramework } = await getBrain();
    writeContextFramework('new-company', { x: 1 });
    expect(fs.existsSync(path.join(tmpRoot, 'companies', 'new-company', 'context_framework.json'))).toBe(true);
  });
});
