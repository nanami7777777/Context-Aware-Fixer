// Anthropic Claude Provider — Streaming chat completions via native fetch

import type { ChatMessage, LLMOptions } from '../types.js';
import type { LLMProvider } from './provider.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Default LLM options for Anthropic calls */
const DEFAULT_OPTIONS: LLMOptions = {
  temperature: 0.2,
  maxTokens: 4096,
  stream: true,
};

/**
 * Anthropic Claude LLM provider using native fetch and SSE streaming.
 * No external SDK dependency — keeps the bundle lean.
 */
export class AnthropicProvider implements LLMProvider {
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.apiKey = apiKey;
    this.model = model;
    this.modelId = `anthropic:${model}`;
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
   * Anthropic's API separates the system message from the messages array.
   * System content goes in the top-level `system` field, while user/assistant
   * messages go in the `messages` array.
   */
  async *chat(
    messages: ChatMessage[],
    options?: LLMOptions,
  ): AsyncIterable<string> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Separate system message from conversation messages
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: conversationMessages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      stream: opts.stream,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic API error (${response.status}): ${errorText}`,
      );
    }

    if (!opts.stream) {
      // Non-streaming: return the full content at once
      const json = await response.json();
      const content =
        json.content?.[0]?.type === 'text' ? json.content[0].text : '';
      if (content) yield content;
      return;
    }

    // Streaming: parse SSE lines from the response body
    yield* this.parseSSEStream(response);
  }

  /**
   * Parse an SSE stream from an Anthropic Messages API response,
   * yielding content delta strings.
   *
   * Anthropic SSE events use `event:` and `data:` lines.
   * We look for `content_block_delta` events with `text_delta` payloads.
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

          try {
            const parsed = JSON.parse(data);

            // content_block_delta events carry text chunks
            if (
              parsed.type === 'content_block_delta' &&
              parsed.delta?.type === 'text_delta'
            ) {
              const text = parsed.delta.text;
              if (text) yield text;
            }

            // message_stop signals the end of the stream
            if (parsed.type === 'message_stop') return;
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
