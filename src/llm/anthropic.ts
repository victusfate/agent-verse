import Anthropic from '@anthropic-ai/sdk';
import type { Model, LlmRequestOptions } from './index.js';

export class AnthropicModel implements Model {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;

  constructor(readonly id: string) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options: LlmRequestOptions = {},
  ): Promise<string> {
    const { temperature = 0.2, maxTokens = 2048, jsonMode = false } = options;

    const system = jsonMode
      ? `${systemInstruction}\n\nRespond with a valid JSON object only. No prose, no markdown.`
      : systemInstruction;

    // Anthropic has no native JSON mode — use assistant prefill of "{" to coerce JSON.
    const messages: Anthropic.MessageParam[] = jsonMode
      ? [{ role: 'user', content: prompt }, { role: 'assistant', content: '{' }]
      : [{ role: 'user', content: prompt }];

    const response = await this.client.messages.create({
      model: this.id,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
    });

    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Expected text response from Anthropic');

    // Prepend the prefilled "{" that was consumed by the messages array
    return jsonMode ? '{' + block.text : block.text;
  }
}
