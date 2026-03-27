import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './openai.js';

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

describe('OpenAIProvider', () => {
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
      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      expect(provider.modelId).toBe('openai:gpt-4');
    });

    it('throws when apiKey is empty', () => {
      expect(() => new OpenAIProvider('', 'gpt-4')).toThrow(
        'OpenAI API key is required',
      );
    });
  });

  // ── estimateTokens ──────────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      expect(provider.estimateTokens('')).toBe(0);
    });

    it('estimates ~4 chars per token', () => {
      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      // 12 chars → ceil(12/4) = 3 tokens
      expect(provider.estimateTokens('hello world!')).toBe(3);
    });

    it('rounds up partial tokens', () => {
      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      // 5 chars → ceil(5/4) = 2 tokens
      expect(provider.estimateTokens('abcde')).toBe(2);
    });
  });

  // ── chat (streaming) ───────────────────────────────────────────────────

  describe('chat streaming', () => {
    it('yields content deltas from SSE stream', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'Hi' }]),
      );

      expect(result).toBe('Hello world');
    });

    it('sends correct request headers and body', async () => {
      const sseData = ['data: [DONE]\n\n'];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new OpenAIProvider('sk-test-key', 'gpt-4-turbo');
      await collect(
        provider.chat(
          [{ role: 'system', content: 'You are helpful' }],
          { temperature: 0.5, maxTokens: 1000, stream: true },
        ),
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');

      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-test-key');
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-4-turbo');
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(1000);
      expect(body.stream).toBe(true);
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
      ]);
    });

    it('skips SSE lines without content delta', async () => {
      const sseData = [
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(sseData)),
      );

      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'test' }]),
      );

      expect(result).toBe('ok');
    });

    it('handles chunked SSE data split across reads', async () => {
      // Simulate data split mid-line across two chunks
      const chunks = [
        'data: {"choices":[{"delta":{"con',
        'tent":"split"}}]}\n\ndata: [DONE]\n\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(sseStream(chunks)),
      );

      const provider = new OpenAIProvider('sk-key', 'gpt-4');
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
        choices: [{ message: { content: 'Full response' } }],
      };

      fetchSpy.mockResolvedValueOnce(mockJsonResponse(json));

      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      const result = await collect(
        provider.chat(
          [{ role: 'user', content: 'Hi' }],
          { temperature: 0.2, maxTokens: 100, stream: false },
        ),
      );

      expect(result).toBe('Full response');
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

      const provider = new OpenAIProvider('sk-bad', 'gpt-4');
      await expect(
        collect(provider.chat([{ role: 'user', content: 'Hi' }])),
      ).rejects.toThrow('OpenAI API error (401)');
    });

    it('throws when response body is null in streaming mode', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);

      const provider = new OpenAIProvider('sk-key', 'gpt-4');
      await expect(
        collect(provider.chat([{ role: 'user', content: 'Hi' }])),
      ).rejects.toThrow('Response body is not readable');
    });
  });
});
