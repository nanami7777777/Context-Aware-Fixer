import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './anthropic.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a ReadableStream that emits the given SSE chunks */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

/** Create a mock Response with the given body stream and status */
function mockResponse(
  body: ReadableStream<Uint8Array>,
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    text: async () => '',
    json: async () => ({}),
    headers: new Headers(),
  } as unknown as Response;
}

/** Create a mock non-streaming JSON Response */
function mockJsonResponse(json: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    text: async () => JSON.stringify(json),
    json: async () => json,
    headers: new Headers(),
  } as unknown as Response;
}

/** Collect all chunks from an async iterable into a single string */
async function collect(iter: AsyncIterable<string>): Promise<string> {
  let result = '';
  for await (const chunk of iter) {
    result += chunk;
  }
  return result;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AnthropicProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('sets modelId from provider prefix and model name', () => {
      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      expect(provider.modelId).toBe('anthropic:claude-3-sonnet');
    });

    it('throws when apiKey is empty', () => {
      expect(() => new AnthropicProvider('', 'claude-3-sonnet')).toThrow(
        'Anthropic API key is required',
      );
    });
  });

  // ── estimateTokens ──────────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      expect(provider.estimateTokens('')).toBe(0);
    });

    it('estimates ~4 chars per token', () => {
      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      // 12 chars → ceil(12/4) = 3 tokens
      expect(provider.estimateTokens('hello world!')).toBe(3);
    });

    it('rounds up partial tokens', () => {
      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      // 5 chars → ceil(5/4) = 2 tokens
      expect(provider.estimateTokens('abcde')).toBe(2);
    });
  });

  // ── chat (streaming) ───────────────────────────────────────────────────

  describe('chat streaming', () => {
    it('yields content deltas from SSE stream', async () => {
      const sseData = [
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'Hi' }]),
      );

      expect(result).toBe('Hello world');
    });

    it('sends correct request headers and body', async () => {
      const sseData = ['event: message_stop\ndata: {"type":"message_stop"}\n\n'];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new AnthropicProvider('sk-test-key', 'claude-3-opus');
      await collect(
        provider.chat(
          [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
          { temperature: 0.5, maxTokens: 1000, stream: true },
        ),
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/messages');

      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('claude-3-opus');
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(1000);
      expect(body.stream).toBe(true);
      // System message should be separate from messages array
      expect(body.system).toBe('You are helpful');
      expect(body.messages).toEqual([
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('omits system field when no system message is provided', async () => {
      const sseData = ['event: message_stop\ndata: {"type":"message_stop"}\n\n'];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      await collect(
        provider.chat([{ role: 'user', content: 'Hi' }]),
      );

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.system).toBeUndefined();
    });

    it('skips SSE events that are not content_block_delta', async () => {
      const sseData = [
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'test' }]),
      );

      expect(result).toBe('ok');
    });

    it('handles chunked SSE data split across reads', async () => {
      const chunks = [
        'event: content_block_delta\ndata: {"type":"content_block_del',
        'ta","delta":{"type":"text_delta","text":"split"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(chunks)),
      );

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'test' }]),
      );

      expect(result).toBe('split');
    });
  });

  // ── chat (non-streaming) ──────────────────────────────────────────────

  describe('chat non-streaming', () => {
    it('returns full content from JSON response', async () => {
      const json = {
        content: [{ type: 'text', text: 'Full response' }],
      };

      fetchSpy.mockResolvedValueOnce(mockJsonResponse(json));

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      const result = await collect(
        provider.chat(
          [{ role: 'user', content: 'Hi' }],
          { temperature: 0.2, maxTokens: 100, stream: false },
        ),
      );

      expect(result).toBe('Full response');
    });

    it('returns empty for non-text content blocks', async () => {
      const json = {
        content: [{ type: 'image', source: {} }],
      };

      fetchSpy.mockResolvedValueOnce(mockJsonResponse(json));

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      const result = await collect(
        provider.chat(
          [{ role: 'user', content: 'Hi' }],
          { temperature: 0.2, maxTokens: 100, stream: false },
        ),
      );

      expect(result).toBe('');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on non-OK HTTP status', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":{"message":"Invalid API key"}}',
      } as unknown as Response);

      const provider = new AnthropicProvider('sk-bad', 'claude-3-sonnet');
      await expect(
        collect(provider.chat([{ role: 'user', content: 'Hi' }])),
      ).rejects.toThrow('Anthropic API error (401)');
    });

    it('throws when response body is null in streaming mode', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);

      const provider = new AnthropicProvider('sk-key', 'claude-3-sonnet');
      await expect(
        collect(provider.chat([{ role: 'user', content: 'Hi' }])),
      ).rejects.toThrow('Response body is not readable');
    });
  });
});
