/**
 * Phase 1 — Idea-Agent
 * Scans for micro-business opportunities and outputs a standardized VenturePayload.
 */
import { VenturePayloadSchema, type VenturePayload } from '../schemas.js';
import { withJsonSchema, parseModelJson, createModel } from '../llm/index.js';

const SYSTEM_PROMPT = `You are an Idea-Agent in an autonomous corporate AI ecosystem.

Your mandate: identify high-margin, low-overhead programmatic service opportunities
that can be fully automated via APIs and LLM capabilities.

Criteria for a strong concept:
- Fully digital — no physical components
- Operated entirely by AI agents via API calls
- Clear recurring revenue model (subscription, per-use, or B2B SaaS)
- Addressable with under $50 of LLM costs to build the MVP
- Target audience willing to pay for automation`;

const SCHEMA_HINT = `{
  "company_name": "string (kebab-case, e.g. pdf-to-podcast-api)",
  "core_value_proposition": "string",
  "target_audience": "string",
  "initial_capability_requirements": ["array", "of", "required", "APIs"],
  "estimated_token_cost_ceiling_usd": 50
}`;

export async function run(seedPrompt?: string): Promise<VenturePayload> {
  const model = await createModel();
  console.log(`[Idea-Agent] Generating venture concept... (model=${model.id}, provider=${model.provider})`);

  const userPrompt = seedPrompt
    ?? 'Identify one high-value micro-business opportunity that AI agents can execute autonomously. Focus on B2B tooling, developer infrastructure, or AI-augmented workflows.';

  const raw = await model.generate(
    withJsonSchema(SYSTEM_PROMPT, SCHEMA_HINT),
    userPrompt,
    { jsonMode: true, temperature: 0.7 },
  );

  const payload = VenturePayloadSchema.parse(parseModelJson(raw));
  console.log(`[Idea-Agent] ✓ Venture identified: ${payload.company_name}`);
  return payload;
}
