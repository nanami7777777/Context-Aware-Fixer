import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from './ollama.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a ReadableStream that emits the given NDJSON chunks */
function ndjsonStream(chunks: string[]): ReadableStream<Uint8Array> {
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

describe('OllamaProvider', () => {
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
      const provider = new OllamaProvider('codellama');
      expect(provider.modelId).toBe('ollama:codellama');
    });

    it('does not require an API key', () => {
      expect(() => new OllamaProvider('codellama')).not.toThrow();
    });

    it('uses default base URL when not specified', async () => {
      const ndjsonData = [
        '{"message":{"content":"hi"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(ndjsonData)),
      );

      const provider = new OllamaProvider('codellama');
      await collect(provider.chat([{ role: 'user', content: 'Hi' }]));

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:11434/api/chat');
    });

    it('accepts a custom base URL', async () => {
      const ndjsonData = [
        '{"message":{"content":"hi"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(ndjsonData)),
      );

      const provider = new OllamaProvider('codellama', 'http://myhost:9999');
      await collect(provider.chat([{ role: 'user', content: 'Hi' }]));

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://myhost:9999/api/chat');
    });

    it('strips trailing slashes from base URL', async () => {
      const ndjsonData = [
        '{"message":{"content":"hi"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(ndjsonData)),
      );

      const provider = new OllamaProvider('codellama', 'http://myhost:9999///');
      await collect(provider.chat([{ role: 'user', content: 'Hi' }]));

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://myhost:9999/api/chat');
    });
  });

  // ── estimateTokens ──────────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('returns 0 for empty string', () => {
      const provider = new OllamaProvider('codellama');
      expect(provider.estimateTokens('')).toBe(0);
    });

    it('estimates ~4 chars per token', () => {
      const provider = new OllamaProvider('codellama');
      // 12 chars → ceil(12/4) = 3 tokens
      expect(provider.estimateTokens('hello world!')).toBe(3);
    });

    it('rounds up partial tokens', () => {
      const provider = new OllamaProvider('codellama');
      // 5 chars → ceil(5/4) = 2 tokens
      expect(provider.estimateTokens('abcde')).toBe(2);
    });
  });

  // ── chat (streaming) ───────────────────────────────────────────────────

  describe('chat streaming', () => {
    it('yields content from NDJSON stream', async () => {
      const ndjsonData = [
        '{"message":{"role":"assistant","content":"Hello"},"done":false}\n',
        '{"message":{"role":"assistant","content":" world"},"done":false}\n',
        '{"done":true}\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(ndjsonData)),
      );

      const provider = new OllamaProvider('codellama');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'Hi' }]),
      );

      expect(result).toBe('Hello world');
    });

    it('sends correct request headers and body', async () => {
      const ndjsonData = ['{"done":true}\n'];
      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(ndjsonData)),
      );

      const provider = new OllamaProvider('codellama');
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
      expect(url).toBe('http://localhost:11434/api/chat');

      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('codellama');
      expect(body.stream).toBe(true);
      expect(body.options.temperature).toBe(0.5);
      expect(body.options.num_predict).toBe(1000);
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('handles chunked NDJSON data split across reads', async () => {
      const chunks = [
        '{"message":{"role":"assistant","content":"spl',
        'it"},"done":false}\n{"done":true}\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(chunks)),
      );

      const provider = new OllamaProvider('codellama');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'test' }]),
      );

      expect(result).toBe('split');
    });

    it('skips lines without message content', async () => {
      const ndjsonData = [
        '{"message":{"role":"assistant","content":""},"done":false}\n',
        '{"message":{"role":"assistant","content":"ok"},"done":false}\n',
        '{"done":true}\n',
      ];

      fetchSpy.mockResolvedValueOnce(
        mockResponse(ndjsonStream(ndjsonData)),
      );

      const provider = new OllamaProvider('codellama');
      const result = await collect(
        provider.chat([{ role: 'user', content: 'test' }]),
      );

      expect(result).toBe('ok');
    });
  });

  // ── chat (non-streaming) ──────────────────────────────────────────────

  describe('chat non-streaming', () => {
    it('returns full content from JSON response', async () => {
      const json = {
        message: { role: 'assistant', content: 'Full response' },
        done: true,
      };

      fetchSpy.mockResolvedValueOnce(mockJsonResponse(json));

      const provider = new OllamaProvider('codellama');
      const result = await collect(
        provider.chat(
          [{ role: 'user', content: 'Hi' }],
          { temperature: 0.2, maxTokens: 100, stream: false },
        ),
      );

      expect(result).toBe('Full response');
    });

    it('returns empty when message has no content', async () => {
      const json = {
        message: { role: 'assistant' },
        done: true,
      };

      fetchSpy.mockResolvedValueOnce(mockJsonResponse(json));

      const provider = new OllamaProvider('codellama');
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
        status: 404,
        text: async () => '{"error":"model not found"}',
      } as unknown as Response);

      const provider = new OllamaProvider('nonexistent');
      await expect(
        collect(provider.chat([{ role: 'user', content: 'Hi' }])),
      ).rejects.toThrow('Ollama API error (404)');
    });

    it('throws when response body is null in streaming mode', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response);

      const provider = new OllamaProvider('codellama');
      await expect(
        collect(provider.chat([{ role: 'user', content: 'Hi' }])),
      ).rejects.toThrow('Response body is not readable');
    });
  });
});
