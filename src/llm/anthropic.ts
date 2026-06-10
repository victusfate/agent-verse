import Anthropic from '@anthropic-ai/sdk';
import type { Model, LlmRequestOptions, GenerateResult } from './index.js';

export class AnthropicModel implements Model {
  readonly provider = 'anthropic' as const;
  private client: Anthropic;

  constructor(readonly id: string) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(`ANTHROPIC_API_KEY is not set, but model '${id}' requires it`);
    }
    this.client = new Anthropic({ apiKey });
  }

  async generate(
    systemInstruction: string,
    prompt: string,
    options: LlmRequestOptions = {},
  ): Promise<GenerateResult> {
    const { temperature = 0.2, maxTokens = 2048, jsonMode = false } = options;

    const system = jsonMode
      ? `${systemInstruction}\n\nRespond with a valid JSON object only. No prose, no markdown.`
      : systemInstruction;

    // Anthropic has no native JSON mode — use assistant prefill of "{" to coerce JSON.
    // The consumed "{" is repaired downstream by parseModelJson, never here.
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

    if (response.stop_reason === 'max_tokens') {
      throw new Error(`Response truncated at max_tokens=${maxTokens} for model '${this.id}'`);
    }

    const block = response.content[0];
    if (!block) throw new Error(`Empty completion from anthropic model '${this.id}'`);
    if (block.type !== 'text') throw new Error('Expected text response from Anthropic');

    const usage = response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      : undefined;

    return { text: block.text, ...(usage ? { usage } : {}) };
  }
}
