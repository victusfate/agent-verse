import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { writeContextFramework, readContextFramework, writeSkills, readSkills } from '../companyBrain.js';

// companyBrain anchors to COMPANIES_DIR (env override) — point it at a temp dir.
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'av-brain-'));
  process.env['COMPANIES_DIR'] = path.join(tmpRoot, 'companies');
});

afterEach(() => {
  delete process.env['COMPANIES_DIR'];
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('companyBrain', () => {
  it('context framework round-trips correctly', () => {
    const ctx = { mission: 'Ship fast', budget: 50, nested: { a: 1 } };
    writeContextFramework('test-co', ctx);
    expect(readContextFramework('test-co')).toEqual(ctx);
  });

  it('skills round-trips correctly', () => {
    const md = '# Skills\n\n- Do things\n- Do more things\n';
    writeSkills('test-co', md);
    expect(readSkills('test-co')).toBe(md);
  });

  it('readContextFramework returns {} for missing company', () => {
    expect(readContextFramework('no-such-company')).toEqual({});
  });

  it('readSkills returns empty string for missing company', () => {
    expect(readSkills('no-such-company')).toBe('');
  });

  it('writeContextFramework creates intermediate directories', () => {
    writeContextFramework('new-company', { x: 1 });
    expect(fs.existsSync(path.join(tmpRoot, 'companies', 'new-company', 'context_framework.json'))).toBe(true);
  });

  it('writes under COMPANIES_DIR, not the current working directory', () => {
    writeSkills('env-co', '# anchored\n');
    expect(fs.existsSync(path.join(tmpRoot, 'companies', 'env-co', 'skills.md'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'companies', 'env-co'))).toBe(false);
  });
});
