// OpenAI Provider — Streaming chat completions via native fetch

import type { ChatMessage, LLMOptions } from '../types.js';
import type { LLMProvider } from './provider.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Default LLM options for OpenAI calls */
const DEFAULT_OPTIONS: LLMOptions = {
  temperature: 0.2,
  maxTokens: 4096,
  stream: true,
};

/**
 * OpenAI LLM provider using native fetch and SSE streaming.
 * No external openai SDK dependency — keeps the bundle lean.
 * Supports custom base URL for OpenAI-compatible APIs (e.g. DashScope, Azure).
 */
export class OpenAIProvider implements LLMProvider {
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly chatUrl: string;

  constructor(apiKey: string, model: string, baseUrl?: string) {
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.modelId = `openai:${model}`;
    const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.chatUrl = `${base}/chat/completions`;
  }

  /**
   * Estimate token count using a simple heuristic (~4 chars per token).
   */
  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Send chat messages and yield streamed content chunks.
   */
  async *chat(
    messages: ChatMessage[],
    options?: LLMOptions,
  ): AsyncIterable<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: opts.stream,
    };

    const response = await fetch(this.chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API error (${response.status}): ${errorText}`,
      );
    }

    if (!opts.stream) {
      // Non-streaming: return the full content at once
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content ?? '';
      if (content) yield content;
      return;
    }

    // Streaming: parse SSE lines from the response body
    yield* this.parseSSEStream(response);
  }

  /**
   * Parse an SSE stream from an OpenAI chat completions response,
   * yielding content delta strings.
   */
  private async *parseSSEStream(
    response: Response,
  ): AsyncIterable<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6); // strip "data: "
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
