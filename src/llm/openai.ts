import OpenAI from 'openai';
import type { Model, LlmProviderType, LlmRequestOptions, GenerateResult } from './index.js';

export interface OpenAICompatibleConfig {
  baseURL?: string;
  apiKey?: string;
  provider?: LlmProviderType;
}

/** o1/o3/o4 reasoning models reject max_tokens and non-default temperature. */
function isReasoningModel(id: string): boolean {
  return /^o[134]/.test(id);
}

/**
 * OpenAIModel — drives the OpenAI API and any OpenAI-compatible endpoint
 * (e.g. Ollama at http://localhost:11434/v1 via the 'local' provider).
 */
export class OpenAIModel implements Model {
  readonly provider: LlmProviderType;
  private client: OpenAI;

  constructor(readonly id: string, config: OpenAICompatibleConfig = {}) {
    this.provider = config.provider ?? 'openai';
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(`OPENAI_API_KEY is not set, but model '${id}' requires it`);
    }
    this.client = new OpenAI({ apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) });
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options: LlmRequestOptions = {},
  ): Promise<GenerateResult> {
    const { temperature = 0.2, maxTokens = 2048, jsonMode = false } = options;

    const tokenParams = isReasoningModel(this.id)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens, temperature };

    const response = await this.client.chat.completions.create({
      model: this.id,
      ...tokenParams,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    const text = response.choices[0]?.message?.content;
    if (!text) {
      throw new Error(`Empty completion from ${this.provider} model '${this.id}'`);
    }

    const usage = response.usage
      ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
      : undefined;

    return { text, ...(usage ? { usage } : {}) };
  }
}
