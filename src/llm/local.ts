import OpenAI from 'openai';
import type { Model, LlmRequestOptions } from './index.js';

/**
 * LocalModel — wraps any OpenAI-compatible endpoint.
 * Default: Ollama at http://localhost:11434/v1
 * Override: set OLLAMA_API_BASE to point at another host.
 */
export class LocalModel implements Model {
  readonly provider = 'local' as const;
  private client: OpenAI;

  constructor(readonly id: string) {
    this.client = new OpenAI({
      baseURL: `${process.env.OLLAMA_API_BASE ?? 'http://localhost:11434'}/v1`,
      apiKey: 'ollama', // required by SDK but not validated by Ollama
    });
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options: LlmRequestOptions = {},
  ): Promise<string> {
    const { temperature = 0.2, maxTokens = 2048, jsonMode = false } = options;

    const response = await this.client.chat.completions.create({
      model: this.id,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      // json_object format works with Ollama >= 0.1.34 on models that support it
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    return response.choices[0]?.message?.content ?? '';
  }
}
