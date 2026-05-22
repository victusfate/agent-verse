/**
 * Entry point — Agent-Verse Autonomous Corporate AI Ecosystem
 *
 * Usage:
 *   npm start
 *   npm start -- --seed "AI invoice reconciliation API"
 *   npm start -- --model gpt-4o-mini
 *   npm start -- --model gemini-2.5-flash --provider google
 *   npm start -- --model llama3.2 --provider local
 *   npm start -- --venture '{"company_name":"pdf-ocr-api",...}'
 *   npm start -- --max-cycles 2
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VenturePayload } from './schemas.js';
import { detectProvider, type LlmProviderType } from './llm/index.js';
import { MAX_MONITOR_CYCLES, runGraph } from './graph.js';
import { DB_PATH } from './ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checkCredentials(modelId: string, provider: LlmProviderType): void {
  const required: Partial<Record<LlmProviderType, string>> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
  };
  const envVar = required[provider];
  if (envVar && !process.env[envVar]) {
    console.error(`ERROR: $${envVar} is not set, but model '${modelId}' requires it.`);
    console.error(`       Provider: ${provider}`);
    console.error(`       Set it in .env or export it:`);
    console.error(`         export ${envVar}=...`);
    process.exit(1);
  }
  console.log(`[startup] Provider: ${provider} | Model: ${modelId}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed:        { type: 'string' },
      venture:     { type: 'string' },
      model:       { type: 'string' },
      provider:    { type: 'string' },
      'max-cycles': { type: 'string' },
    },
    allowPositionals: false,
    strict: false,
  });

  // Apply model/provider overrides before anything imports the env
  if (values.model)    process.env['AGENT_MODEL']    = values.model as string;
  if (values.provider) process.env['AGENT_PROVIDER'] = values.provider as string;

  const modelId  = process.env['AGENT_MODEL']    ?? 'claude-sonnet-4-6';
  const provider = (process.env['AGENT_PROVIDER'] as LlmProviderType | undefined) ?? detectProvider(modelId);

  if (values['max-cycles']) {
    const n = parseInt(values['max-cycles'] as string, 10);
    if (!isNaN(n)) {
      const graphModule = await import('./graph.js');
      graphModule.MAX_MONITOR_CYCLES = n;
    }
  }

  checkCredentials(modelId, provider);

  console.log('='.repeat(60));
  console.log('  AGENT-VERSE  |  Autonomous Corporate AI Ecosystem');
  console.log('='.repeat(60));
  console.log();

  const initialVenture = values.venture
    ? JSON.parse(values.venture as string) as VenturePayload
    : null;

  const finalState = await runGraph({
    venturePayload: initialVenture,
    seedPrompt: values.seed as string | undefined ?? null,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log();
  console.log('='.repeat(60));
  console.log('  EXECUTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Company:   ${finalState.companyId}`);
  console.log(`  Cycles:    ${finalState.cycle}`);
  console.log(`  Model:     ${modelId}`);

  const completed = finalState.operatorTasks.filter(t => t.status === 'completed').length;
  console.log(`  Tasks:     ${completed}/${finalState.operatorTasks.length} completed`);

  const report = finalState.monitorReport;
  console.log(`  Monitor:   ${report?.mitigation_type ?? 'n/a'}`);

  const brainDir = path.join(__dirname, '..', 'companies', finalState.companyId);
  console.log(`  Brain:     ${brainDir}`);
  console.log(`  Ledger:    ${DB_PATH}`);
  console.log();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
