import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Model, LlmRequestOptions } from './index.js';

export class GoogleModel implements Model {
  readonly provider = 'google' as const;
  private client: GoogleGenerativeAI;

  constructor(readonly id: string) {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options: LlmRequestOptions = {},
  ): Promise<string> {
    const { temperature = 0.2, maxTokens = 2048, jsonMode = false } = options;

    const genModel = this.client.getGenerativeModel({
      model: this.id,
      systemInstruction,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });

    const result = await genModel.generateContent(prompt);
    return result.response.text();
  }
}
