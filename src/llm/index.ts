/**
 * Agent-Verse Multi-Provider LLM Client Interface
 * Standardized, native TypeScript contract for calling cloud and local models.
 * Capable of driving OpenAI, Anthropic, Google Gemini, and Local/Custom LLMs (Ollama).
 */

export type LlmProviderType = 'google' | 'openai' | 'anthropic' | 'local' | 'cli' | 'simulated';

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

  /**
   * Explicit fixture selector for the simulated provider.
   * Ignored by real providers.
   */
  fixtureKey?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult {
  /** The generated response content as a raw string (or JSON string). */
  text: string;
  /** Token usage as reported by the provider SDK, when available. */
  usage?: TokenUsage;
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
   */
  generate(
    systemInstruction: string,
    prompt: string,
    options?: LlmRequestOptions,
  ): Promise<GenerateResult>;
}

// ── Provider auto-detection ───────────────────────────────────────────────────

export function detectProvider(modelId: string): LlmProviderType {
  const id = modelId.toLowerCase();
  if (id.startsWith('cli:')) return 'cli';
  if (id === 'simulated' || id.startsWith('simulated:')) return 'simulated';
  if (id.startsWith('claude') || id.startsWith('anthropic/')) return 'anthropic';
  if (id.startsWith('gemini') || id.startsWith('google/')) return 'google';
  if (id.startsWith('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('openai/')) return 'openai';
  if (id.startsWith('ollama/') || id.startsWith('llama') || id.startsWith('qwen') || id.startsWith('mistral') || id.startsWith('phi')) return 'local';
  return 'openai'; // default: treat unknown IDs as OpenAI-compatible
}

export function stripProviderPrefix(modelId: string): string {
  return modelId.replace(/^(anthropic|google|openai|ollama)\//, '').replace(/^cli:/, '');
}

// ── Factory ───────────────────────────────────────────────────────────────────

const modelCache = new Map<string, Model>();

export async function createModel(
  modelId?: string,
  provider?: LlmProviderType,
): Promise<Model> {
  const rawId = modelId ?? process.env.AGENT_MODEL ?? 'claude-sonnet-4-6';
  // AGENT_PROVIDER only applies to env-derived model ids — an explicit id wins.
  const envProvider = modelId === undefined
    ? (process.env.AGENT_PROVIDER as LlmProviderType | undefined)
    : undefined;
  const resolvedProvider = provider ?? envProvider ?? detectProvider(rawId);
  const id = stripProviderPrefix(rawId);

  const cacheKey = `${resolvedProvider}:${id}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;

  const model = await instantiate(resolvedProvider, id);
  modelCache.set(cacheKey, model);
  return model;
}

async function instantiate(provider: LlmProviderType, id: string): Promise<Model> {
  switch (provider) {
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
      const { OpenAIModel } = await import('./openai.js');
      return new OpenAIModel(id, {
        baseURL: `${process.env.OLLAMA_API_BASE ?? 'http://localhost:11434'}/v1`,
        apiKey: 'ollama', // required by SDK but not validated by Ollama
        provider: 'local',
      });
    }
    case 'cli': {
      const { CliModel } = await import('./cli.js');
      return new CliModel(id);
    }
    case 'simulated': {
      const { SimulatedModel } = await import('./simulated.js');
      return new SimulatedModel();
    }
    default:
      throw new Error(`Unknown provider: ${provider as string}`);
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
  // Anthropic prefill artifact: the assistant was primed with "{" so the text
  // arrives brace-stripped. Only repair when the tail looks like JSON —
  // never mangle prose error messages.
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[') && cleaned.endsWith('}')) {
    cleaned = '{' + cleaned;
  }
  return JSON.parse(cleaned);
}
