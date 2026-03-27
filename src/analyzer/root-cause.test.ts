import { describe, it, expect, vi } from 'vitest';
import { RootCauseAnalyzer } from './root-cause.js';
import type { AnalysisChunk } from './root-cause.js';
import type { LLMProvider } from '../llm/provider.js';
import type {
  ContextWindow,
  BugReport,
  ChatMessage,
  LLMOptions,
} from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a mock LLMProvider that yields the given response string */
function createMockLLM(response: string): LLMProvider {
  return {
    modelId: 'mock:test',
    async *chat(_messages: ChatMessage[], _options?: LLMOptions) {
      yield response;
    },
    estimateTokens(text: string) {
      return Math.ceil(text.length / 4);
    },
  };
}

/** Create a minimal BugReport for testing */
function createBugReport(overrides?: Partial<BugReport>): BugReport {
  return {
    rawInput: 'TypeError: Cannot read property "x" of undefined',
    source: 'cli-arg',
    errorType: 'TypeError',
    errorMessage: 'Cannot read property "x" of undefined',
    filePaths: [{ path: 'src/app.ts', line: 42 }],
    stackTrace: [
      { filePath: 'src/app.ts', functionName: 'processData', line: 42, column: 10 },
      { filePath: 'src/utils.ts', functionName: 'transform', line: 15 },
    ],
    keywords: ['processData', 'transform'],
    description: 'App crashes when processing null data',
    ...overrides,
  };
}

/** Create a minimal ContextWindow for testing */
function createContextWindow(overrides?: Partial<ContextWindow>): ContextWindow {
  return {
    files: [
      {
        path: 'src/app.ts',
        content: 'function processData(data: any) {\n  return data.x;\n}',
        relevanceScore: 0.95,
        tokenCount: 20,
        isTruncated: false,
      },
      {
        path: 'src/utils.ts',
        content: 'export function transform(input: any) {\n  return processData(input);\n}',
        relevanceScore: 0.7,
        tokenCount: 25,
        isTruncated: true,
        truncationReason: 'token limit exceeded',
      },
    ],
    gitHistory: [
      {
        hash: 'abc1234567890',
        message: 'refactor processData to accept any type',
        author: 'dev',
        date: new Date('2024-01-15'),
        filesChanged: ['src/app.ts'],
      },
    ],
    projectInfo: {
      name: 'test-project',
      language: 'typescript',
      packageManager: 'pnpm',
      dependencies: { typescript: '^5.0.0' },
      configFiles: ['tsconfig.json'],
    },
    totalTokens: 45,
    bugReport: createBugReport(),
    ...overrides,
  };
}

/** Collect all chunks from the async iterable */
async function collectChunks(
  iterable: AsyncIterable<AnalysisChunk>,
): Promise<AnalysisChunk[]> {
  const chunks: AnalysisChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

// ─── Valid LLM Response ──────────────────────────────────────────────────────

const VALID_LLM_RESPONSE = JSON.stringify({
  candidates: [
    {
      rank: 1,
      confidence: 0.6,
      location: { path: 'src/utils.ts', line: 2 },
      description: 'transform passes potentially null input to processData',
      impact: 'Secondary contributor',
      evidence: [
        { type: 'code-snippet', content: 'return processData(input)', source: 'src/utils.ts:2' },
      ],
    },
    {
      rank: 2,
      confidence: 0.92,
      location: { path: 'src/app.ts', line: 2 },
      description: 'processData accesses property x without null check',
      impact: 'App crashes when data is undefined',
      evidence: [
        { type: 'code-snippet', content: 'return data.x;', source: 'src/app.ts:2' },
        { type: 'git-history', content: 'Type was changed to any', source: 'abc1234' },
      ],
    },
  ],
  summary: 'The bug is caused by missing null check in processData',
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RootCauseAnalyzer', () => {
  describe('analyze', () => {
    it('yields progress, candidate, and complete chunks in order', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const chunks = await collectChunks(analyzer.analyze(context, report));

      const types = chunks.map((c) => c.type);
      // Should have: progress, progress, progress, candidate(s), complete
      expect(types.filter((t) => t === 'progress').length).toBeGreaterThanOrEqual(3);
      expect(types.filter((t) => t === 'candidate').length).toBe(2);
      expect(types[types.length - 1]).toBe('complete');
    });

    it('sorts candidates by confidence descending', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const chunks = await collectChunks(analyzer.analyze(context, report));
      const completeChunk = chunks.find((c) => c.type === 'complete')!;
      const finalReport = completeChunk.data as { candidates: Array<{ confidence: number; rank: number }> };

      expect(finalReport.candidates[0].confidence).toBe(0.92);
      expect(finalReport.candidates[1].confidence).toBe(0.6);
      expect(finalReport.candidates[0].rank).toBe(1);
      expect(finalReport.candidates[1].rank).toBe(2);
    });

    it('respects maxCandidates option', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const chunks = await collectChunks(
        analyzer.analyze(context, report, { maxCandidates: 1, stream: true }),
      );
      const completeChunk = chunks.find((c) => c.type === 'complete')!;
      const finalReport = completeChunk.data as { candidates: unknown[] };

      expect(finalReport.candidates.length).toBe(1);
    });

    it('uses default options when none provided', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const chunks = await collectChunks(analyzer.analyze(context, report));
      const completeChunk = chunks.find((c) => c.type === 'complete')!;
      const finalReport = completeChunk.data as { candidates: unknown[] };

      // Default maxCandidates is 3, response has 2
      expect(finalReport.candidates.length).toBe(2);
    });

    it('passes messages to LLM with system and user roles', async () => {
      const chatSpy = vi.fn(async function* () {
        yield VALID_LLM_RESPONSE;
      });
      const llm: LLMProvider = {
        modelId: 'mock:test',
        chat: chatSpy,
        estimateTokens: (text: string) => Math.ceil(text.length / 4),
      };
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      await collectChunks(analyzer.analyze(context, report));

      expect(chatSpy).toHaveBeenCalledOnce();
      const [messages, options] = chatSpy.mock.calls[0] as unknown as [any[], any];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(options?.temperature).toBe(0.2);
    });
  });

  describe('buildMessages', () => {
    it('includes bug report info in user prompt', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('TypeError');
      expect(userContent).toContain('Cannot read property "x" of undefined');
      expect(userContent).toContain('src/app.ts');
      expect(userContent).toContain('processData');
    });

    it('includes context files in user prompt', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('src/app.ts');
      expect(userContent).toContain('function processData');
      expect(userContent).toContain('src/utils.ts');
      expect(userContent).toContain('relevance: 0.95');
    });

    it('includes truncation info for truncated files', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Truncated');
      expect(userContent).toContain('token limit exceeded');
    });

    it('includes stack trace in user prompt', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Stack Trace');
      expect(userContent).toContain('src/app.ts:42:10');
      expect(userContent).toContain('processData');
    });

    it('includes git history in user prompt', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Git History');
      expect(userContent).toContain('abc1234');
      expect(userContent).toContain('refactor processData');
    });

    it('includes project info in user prompt', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('test-project');
      expect(userContent).toContain('typescript');
      expect(userContent).toContain('pnpm');
    });

    it('includes maxCandidates in system prompt', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow();
      const report = createBugReport();

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 5, stream: true });
      const systemContent = messages[0].content;

      expect(systemContent).toContain('5');
    });

    it('handles bug report without optional fields', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const context = createContextWindow({ gitHistory: [], files: [] });
      const report = createBugReport({
        errorType: undefined,
        errorMessage: undefined,
        stackTrace: undefined,
        description: undefined,
        filePaths: [],
      });

      const messages = analyzer.buildMessages(context, report, { maxCandidates: 3, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Bug Report');
      expect(userContent).toContain(report.rawInput);
    });
  });

  describe('parseResponse', () => {
    it('parses valid JSON response into RootCauseReport', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);

      const report = analyzer.parseResponse(VALID_LLM_RESPONSE, 3);

      expect(report.summary).toBe('The bug is caused by missing null check in processData');
      expect(report.candidates).toHaveLength(2);
    });

    it('sorts candidates by confidence descending', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);

      const report = analyzer.parseResponse(VALID_LLM_RESPONSE, 3);

      expect(report.candidates[0].confidence).toBe(0.92);
      expect(report.candidates[1].confidence).toBe(0.6);
    });

    it('assigns ranks after sorting', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);

      const report = analyzer.parseResponse(VALID_LLM_RESPONSE, 3);

      expect(report.candidates[0].rank).toBe(1);
      expect(report.candidates[1].rank).toBe(2);
    });

    it('limits candidates to maxCandidates', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);

      const report = analyzer.parseResponse(VALID_LLM_RESPONSE, 1);

      expect(report.candidates).toHaveLength(1);
      expect(report.candidates[0].confidence).toBe(0.92); // highest confidence kept
    });

    it('handles JSON wrapped in markdown code block', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const wrapped = '```json\n' + VALID_LLM_RESPONSE + '\n```';

      const report = analyzer.parseResponse(wrapped, 3);

      expect(report.candidates).toHaveLength(2);
      expect(report.summary).toBe('The bug is caused by missing null check in processData');
    });

    it('returns fallback report for invalid JSON', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);

      const report = analyzer.parseResponse('not valid json at all', 3);

      expect(report.candidates).toHaveLength(0);
      expect(report.summary).toContain('Failed to parse');
    });

    it('clamps confidence values to [0, 1]', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const response = JSON.stringify({
        candidates: [
          {
            confidence: 1.5,
            location: { path: 'a.ts', line: 1 },
            description: 'over-confident',
            impact: 'high',
            evidence: [],
          },
          {
            confidence: -0.3,
            location: { path: 'b.ts', line: 2 },
            description: 'under-confident',
            impact: 'low',
            evidence: [],
          },
        ],
        summary: 'test',
      });

      const report = analyzer.parseResponse(response, 3);

      expect(report.candidates[0].confidence).toBe(1);
      expect(report.candidates[1].confidence).toBe(0);
    });

    it('skips candidates without description', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const response = JSON.stringify({
        candidates: [
          { confidence: 0.9, location: { path: 'a.ts' }, description: '', impact: 'x', evidence: [] },
          { confidence: 0.8, location: { path: 'b.ts' }, description: 'valid', impact: 'y', evidence: [] },
        ],
        summary: 'test',
      });

      const report = analyzer.parseResponse(response, 3);

      expect(report.candidates).toHaveLength(1);
      expect(report.candidates[0].description).toBe('valid');
    });

    it('handles missing evidence gracefully', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const response = JSON.stringify({
        candidates: [
          { confidence: 0.8, location: { path: 'a.ts' }, description: 'test', impact: 'x' },
        ],
        summary: 'test',
      });

      const report = analyzer.parseResponse(response, 3);

      expect(report.candidates[0].evidence).toEqual([]);
    });

    it('defaults evidence type to code-snippet for unknown types', () => {
      const llm = createMockLLM('');
      const analyzer = new RootCauseAnalyzer(llm);
      const response = JSON.stringify({
        candidates: [
          {
            confidence: 0.8,
            location: { path: 'a.ts' },
            description: 'test',
            impact: 'x',
            evidence: [{ type: 'unknown-type', content: 'data', source: 'file.ts' }],
          },
        ],
        summary: 'test',
      });

      const report = analyzer.parseResponse(response, 3);

      expect(report.candidates[0].evidence[0].type).toBe('code-snippet');
    });
  });
});
