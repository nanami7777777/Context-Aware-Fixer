import { describe, it, expect } from 'vitest';
import { parseModelId, createLLMProvider } from './provider.js';

describe('parseModelId', () => {
  it('parses a valid openai modelId', () => {
    const result = parseModelId('openai:gpt-4');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4' });
  });

  it('parses a valid anthropic modelId', () => {
    const result = parseModelId('anthropic:claude-3-sonnet');
    expect(result).toEqual({ provider: 'anthropic', model: 'claude-3-sonnet' });
  });

  it('parses a valid ollama modelId', () => {
    const result = parseModelId('ollama:codellama');
    expect(result).toEqual({ provider: 'ollama', model: 'codellama' });
  });

  it('handles model names with multiple colons', () => {
    const result = parseModelId('openai:gpt-4:turbo');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4:turbo' });
  });

  it('trims whitespace from modelId', () => {
    const result = parseModelId('  openai:gpt-4  ');
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4' });
  });

  it('throws for empty string', () => {
    expect(() => parseModelId('')).toThrow('modelId must be a non-empty string');
  });

  it('throws for whitespace-only string', () => {
    expect(() => parseModelId('   ')).toThrow('modelId must be a non-empty string');
  });

  it('throws for missing colon separator', () => {
    expect(() => parseModelId('openai-gpt-4')).toThrow('Invalid modelId format');
  });

  it('throws for empty provider name', () => {
    expect(() => parseModelId(':gpt-4')).toThrow('Provider name is empty');
  });

  it('throws for empty model name', () => {
    expect(() => parseModelId('openai:')).toThrow('Model name is empty');
  });

  it('throws for unknown provider', () => {
    expect(() => parseModelId('google:gemini')).toThrow('Unknown provider "google"');
  });

  it('includes supported providers in unknown provider error', () => {
    expect(() => parseModelId('google:gemini')).toThrow('Supported providers: openai, anthropic, ollama');
  });
});

describe('createLLMProvider', () => {
  it('validates modelId format before creating provider', () => {
    expect(() => createLLMProvider('invalid', 'key')).toThrow('Invalid modelId format');
  });

  it('rejects unknown providers', () => {
    expect(() => createLLMProvider('google:gemini', 'key')).toThrow('Unknown provider');
  });

  it('creates an OpenAI provider for openai modelId', () => {
    const provider = createLLMProvider('openai:gpt-4', 'sk-test');
    expect(provider.modelId).toBe('openai:gpt-4');
  });

  it('creates an Anthropic provider for anthropic modelId', () => {
    const provider = createLLMProvider('anthropic:claude-3-sonnet', 'sk-test');
    expect(provider.modelId).toBe('anthropic:claude-3-sonnet');
  });

  it('creates an Ollama provider for ollama modelId', () => {
    const provider = createLLMProvider('ollama:codellama', '');
    expect(provider.modelId).toBe('ollama:codellama');
  });
});
