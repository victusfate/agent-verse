import OpenAI from 'openai';
import type { Model, LlmRequestOptions } from './index.js';

export class OpenAIModel implements Model {
  readonly provider = 'openai' as const;
  private client: OpenAI;

  constructor(readonly id: string) {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    return response.choices[0]?.message?.content ?? '';
  }
}
