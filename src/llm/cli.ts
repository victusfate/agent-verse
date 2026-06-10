import { spawn } from 'node:child_process';
import type { Model, LlmRequestOptions, GenerateResult } from './index.js';

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function shellSplit(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (quote) {
      if (ch === quote) { quote = null; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export class CliModel implements Model {
  readonly provider = 'cli' as const;
  readonly id: string;
  private readonly timeoutMs: number;
  private readonly killGraceMs: number;

  constructor(command: string, timeoutMs = 60_000, killGraceMs = 5_000) {
    this.id = command;
    this.timeoutMs = timeoutMs;
    this.killGraceMs = killGraceMs;
  }

  generate(systemInstruction: string, prompt: string, _options?: LlmRequestOptions): Promise<GenerateResult> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = shellSplit(this.id);
      const child = spawn(cmd!, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      let killTimer: NodeJS.Timeout | null = null;

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        // Escalate if the child ignores SIGTERM
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs);
        killTimer.unref?.();
        reject(new Error(`CliModel timeout after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

      child.on('close', (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (code !== 0) {
          const stderr = Buffer.concat(errChunks).toString().trim();
          reject(new Error(`CliModel exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
          return;
        }
        const raw = Buffer.concat(chunks).toString();
        resolve({ text: raw.replace(ANSI_RE, '').trim() });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        reject(err);
      });

      child.stdin.write(`${systemInstruction}\n\n${prompt}`);
      child.stdin.end();
    });
  }
}
