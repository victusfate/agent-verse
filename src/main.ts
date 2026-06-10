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
import path from 'node:path';
import { detectProvider, type LlmProviderType } from './llm/index.js';
import { resolveRuntime, assertSdkModel, claudeBinaryOnPath } from './llm/runtime.js';
import { runGraph } from './graph.js';
import { defaultDbPath } from './ledger.js';
import { resolveCompaniesDir } from './paths.js';
import { parseCliArgs } from './cliArgs.js';

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
  const args = parseCliArgs(process.argv.slice(2));

  // Apply model/provider overrides before anything imports the env
  if (args.model)    process.env['AGENT_MODEL']    = args.model;
  if (args.provider) process.env['AGENT_PROVIDER'] = args.provider;

  const modelId = process.env['AGENT_MODEL'] ?? 'claude-sonnet-4-6';
  const runtime = resolveRuntime(args.runtime !== undefined ? { flag: args.runtime } : {});

  if (runtime === 'sdk') {
    assertSdkModel(modelId);
    if (!claudeBinaryOnPath()) {
      console.error(`ERROR: --runtime sdk requires the 'claude' binary on PATH.`);
      console.error(`       Install Claude Code: https://code.claude.com/docs`);
      process.exit(1);
    }
    // Route every agent's createModel() through the SDK provider.
    process.env['AGENT_PROVIDER'] = 'sdk';
    console.log(`[startup] Runtime: sdk (local Claude Code) | Model: ${modelId}`);
  } else {
    const provider = (process.env['AGENT_PROVIDER'] as LlmProviderType | undefined) ?? detectProvider(modelId);
    console.log(`[startup] Runtime: api`);
    checkCredentials(modelId, provider);
  }

  console.log('='.repeat(60));
  console.log('  AGENT-VERSE  |  Autonomous Corporate AI Ecosystem');
  console.log('='.repeat(60));
  console.log();

  const finalState = await runGraph({
    venturePayload: args.venture,
    seedPrompt: args.seed ?? null,
    ...(args.maxCycles !== undefined ? { maxCycles: args.maxCycles } : {}),
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

  const brainDir = path.join(resolveCompaniesDir(), finalState.companyId);
  console.log(`  Brain:     ${brainDir}`);
  console.log(`  Ledger:    ${defaultDbPath()}`);
  console.log();
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
