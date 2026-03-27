// Ollama Provider — Streaming chat completions via native fetch (local models)

import type { ChatMessage, LLMOptions } from '../types.js';
import type { LLMProvider } from './provider.js';

/** Default LLM options for Ollama calls */
const DEFAULT_OPTIONS: LLMOptions = {
  temperature: 0.2,
  maxTokens: 4096,
  stream: true,
};

/**
 * Ollama LLM provider using native fetch and newline-delimited JSON streaming.
 * Connects to a local Ollama instance — no API key required.
 */
export class OllamaProvider implements LLMProvider {
  readonly modelId: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(model: string, baseUrl = 'http://localhost:11434') {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // strip trailing slashes
    this.modelId = `ollama:${model}`;
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
   *
   * Ollama uses newline-delimited JSON (NDJSON) for streaming,
   * not SSE like OpenAI/Anthropic.
   */
  async *chat(
    messages: ChatMessage[],
    options?: LLMOptions,
  ): AsyncIterable<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: opts.stream,
      options: {
        temperature: opts.temperature,
        num_predict: opts.maxTokens,
      },
    };

    const url = `${this.baseUrl}/api/chat`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${errorText}`,
      );
    }

    if (!opts.stream) {
      // Non-streaming: return the full content at once
      const json = await response.json();
      const content = json.message?.content ?? '';
      if (content) yield content;
      return;
    }

    // Streaming: parse newline-delimited JSON from the response body
    yield* this.parseNDJSONStream(response);
  }

  /**
   * Parse a newline-delimited JSON stream from an Ollama chat response,
   * yielding content strings.
   *
   * Each line is a JSON object with a `message.content` field.
   * The final object has `done: true`.
   */
  private async *parseNDJSONStream(
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
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);

            // done: true signals the end of the stream
            if (parsed.done) return;

            const content = parsed.message?.content;
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
