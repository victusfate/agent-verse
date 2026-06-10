import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Model, LlmRequestOptions, GenerateResult } from './index.js';

export class GoogleModel implements Model {
  readonly provider = 'google' as const;
  private client: GoogleGenerativeAI;

  constructor(readonly id: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(`GEMINI_API_KEY is not set, but model '${id}' requires it`);
    }
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options: LlmRequestOptions = {},
  ): Promise<GenerateResult> {
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
    const text = result.response.text();
    if (!text) {
      throw new Error(`Empty completion from google model '${this.id}'`);
    }
    const meta = result.response.usageMetadata;
    const usage = meta
      ? { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
      : undefined;
    return { text, ...(usage ? { usage } : {}) };
  }
}
