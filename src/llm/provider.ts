// LLM Provider — Unified interface and factory function

import type { ChatMessage, LLMOptions } from '../types.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';

// ─── Supported LLM Providers ─────────────────────────────────────────────────

/** Known provider identifiers parsed from modelId */
export type LLMProviderType = 'openai' | 'anthropic' | 'ollama';

/** Parsed model identifier */
export interface ParsedModelId {
  provider: LLMProviderType;
  model: string;
}

// ─── LLM Provider Interface ─────────────────────────────────────────────────

/** Unified interface for all LLM providers */
export interface LLMProvider {
  /** Full model identifier (e.g. "openai:gpt-4") */
  readonly modelId: string;

  /** Send messages and get a streaming response */
  chat(messages: ChatMessage[], options?: LLMOptions): AsyncIterable<string>;

  /** Estimate the number of tokens in a text string */
  estimateTokens(text: string): number;
}

// ─── Model ID Parsing ────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set<LLMProviderType>(['openai', 'anthropic', 'ollama']);

/**
 * Parse a modelId string in the format "provider:model".
 * Throws if the format is invalid or the provider is unknown.
 */
export function parseModelId(modelId: string): ParsedModelId {
  if (!modelId || typeof modelId !== 'string') {
    throw new Error('modelId must be a non-empty string');
  }

  const trimmed = modelId.trim();
  if (!trimmed) {
    throw new Error('modelId must be a non-empty string');
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(
      `Invalid modelId format "${trimmed}". Expected "provider:model" (e.g. "openai:gpt-4")`
    );
  }

  const provider = trimmed.slice(0, colonIndex);
  const model = trimmed.slice(colonIndex + 1);

  if (!provider) {
    throw new Error(
      `Invalid modelId format "${trimmed}". Provider name is empty. Expected "provider:model"`
    );
  }

  if (!model) {
    throw new Error(
      `Invalid modelId format "${trimmed}". Model name is empty. Expected "provider:model"`
    );
  }

  if (!VALID_PROVIDERS.has(provider as LLMProviderType)) {
    const supported = [...VALID_PROVIDERS].join(', ');
    throw new Error(
      `Unknown provider "${provider}". Supported providers: ${supported}`
    );
  }

  return { provider: provider as LLMProviderType, model };
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create an LLM provider instance based on the modelId.
 *
 * @param modelId - Format: "provider:model" (e.g. "openai:gpt-4", "anthropic:claude-3-sonnet", "ollama:codellama")
 * @param apiKey - API key for the provider (not required for ollama)
 * @param baseUrl - Custom base URL for OpenAI-compatible APIs
 */
export function createLLMProvider(modelId: string, apiKey: string, baseUrl?: string): LLMProvider {
  const parsed = parseModelId(modelId);

  switch (parsed.provider) {
    case 'openai':
      return new OpenAIProvider(apiKey, parsed.model, baseUrl);
    case 'anthropic':
      return new AnthropicProvider(apiKey, parsed.model);
    case 'ollama':
      return new OllamaProvider(parsed.model);
  }
}
