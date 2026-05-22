/**
 * Agent-Verse Multi-Provider LLM Client Interface
 * Standardized, native TypeScript contract for calling cloud and local models.
 * Capable of driving OpenAI, Anthropic, Google Gemini, and Local/Custom LLMs (Ollama).
 */

export type LlmProviderType = 'google' | 'openai' | 'anthropic' | 'local';

export interface LlmRequestOptions {
  /**
   * Enforce strict JSON output mode.
   * If true, the model is configured to return parsed JSON schemas.
   */
  jsonMode?: boolean;

  /**
   * Control randomness/creativity of response generation.
   * Typically defaults to 0.2 for analytical/agentic runs.
   */
  temperature?: number;

  /**
   * Max output tokens to limit response length.
   */
  maxTokens?: number;
}

export interface Model {
  /**
   * The unique model identifier.
   * e.g., 'gemini-2.5-flash', 'gpt-4o', 'claude-sonnet-4-6', or local 'llama3.1:8b'
   */
  id: string;

  /**
   * The targeted model provider.
   */
  provider: LlmProviderType;

  /**
   * Standard generation interface for text and structured payloads.
   *
   * @param systemInstruction The framing persona and guiding rules for the LLM.
   * @param prompt The user/operator prompt containing raw tasks or context.
   * @param options Execution configurations (jsonMode, temperature, maxTokens).
   * @returns The generated response content as a raw string (or JSON string).
   */
  generate(
    systemInstruction: string,
    prompt: string,
    options?: LlmRequestOptions,
  ): Promise<string>;
}

// ── Provider auto-detection ───────────────────────────────────────────────────

export function detectProvider(modelId: string): LlmProviderType {
  const id = modelId.toLowerCase();
  if (id.startsWith('claude') || id.startsWith('anthropic/')) return 'anthropic';
  if (id.startsWith('gemini') || id.startsWith('google/')) return 'google';
  if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('openai/')) return 'openai';
  if (id.startsWith('ollama/') || id.startsWith('llama') || id.startsWith('qwen') || id.startsWith('mistral') || id.startsWith('phi')) return 'local';
  return 'openai'; // default: treat unknown IDs as OpenAI-compatible
}

export function stripProviderPrefix(modelId: string): string {
  return modelId.replace(/^(anthropic|google|openai|ollama)\//, '');
}

// ── Factory ───────────────────────────────────────────────────────────────────

export async function createModel(
  modelId?: string,
  provider?: LlmProviderType,
): Promise<Model> {
  const rawId = modelId ?? process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
  const resolvedProvider = provider ?? (process.env.AGENT_PROVIDER as LlmProviderType | undefined) ?? detectProvider(rawId);
  const id = stripProviderPrefix(rawId);

  switch (resolvedProvider) {
    case 'anthropic': {
      const { AnthropicModel } = await import('./anthropic.js');
      return new AnthropicModel(id);
    }
    case 'openai': {
      const { OpenAIModel } = await import('./openai.js');
      return new OpenAIModel(id);
    }
    case 'google': {
      const { GoogleModel } = await import('./google.js');
      return new GoogleModel(id);
    }
    case 'local': {
      const { LocalModel } = await import('./local.js');
      return new LocalModel(id);
    }
    default:
      throw new Error(`Unknown provider: ${resolvedProvider as string}`);
  }
}

// ── Helpers for agents ────────────────────────────────────────────────────────

/** Append a JSON schema directive to a system prompt for jsonMode calls. */
export function withJsonSchema(systemInstruction: string, schema: string): string {
  return `${systemInstruction}

You MUST respond with a single valid JSON object that exactly matches this schema:
${schema}

Rules:
- Return ONLY the raw JSON — no markdown, no prose, no code fences.
- Every required field must be present.
- String values should be thorough and specific.`;
}

/** Parse a JSON string returned by a model, stripping common model artifacts. */
export function parseModelJson(raw: string): unknown {
  let cleaned = raw.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  // Some models prefill with { and return without the opening brace
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    cleaned = '{' + cleaned;
  }
  return JSON.parse(cleaned);
}
