import { describe, it, expect } from 'vitest';
import { parseModelJson, withJsonSchema } from '../llm/index.js';

describe('parseModelJson', () => {
  it('parses clean JSON string', () => {
    const result = parseModelJson('{"company_name":"foo","value":42}');
    expect(result).toEqual({ company_name: 'foo', value: 42 });
  });

  it('strips markdown code fences (```json ... ```)', () => {
    const raw = '```json\n{"key":"val"}\n```';
    expect(parseModelJson(raw)).toEqual({ key: 'val' });
  });

  it('strips plain code fences (``` ... ```)', () => {
    const raw = '```\n{"key":"val"}\n```';
    expect(parseModelJson(raw)).toEqual({ key: 'val' });
  });

  it('prepends missing { for Anthropic prefill artefact', () => {
    // Anthropic prefill sends "{", model returns the rest without the opening brace
    const raw = '"company_name":"pdf-ocr","value":1}';
    expect(parseModelJson(raw)).toEqual({ company_name: 'pdf-ocr', value: 1 });
  });

  it('handles already-valid object with leading {', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('handles JSON arrays without prepending {', () => {
    expect(parseModelJson('["a","b"]')).toEqual(['a', 'b']);
  });

  it('throws SyntaxError on truly invalid JSON', () => {
    expect(() => parseModelJson('this is not json at all')).toThrow(SyntaxError);
  });
});

describe('withJsonSchema', () => {
  it('includes original system instruction', () => {
    const result = withJsonSchema('You are an agent.', '{"key":"string"}');
    expect(result).toContain('You are an agent.');
  });

  it('includes the schema hint', () => {
    const schema = '{"company_name":"string"}';
    const result = withJsonSchema('System.', schema);
    expect(result).toContain(schema);
  });

  it('includes JSON-only instruction', () => {
    const result = withJsonSchema('System.', '{}');
    expect(result).toContain('Return ONLY the raw JSON');
  });
});
