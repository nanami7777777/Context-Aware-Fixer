import { describe, it, expect, vi } from 'vitest';
import { PatchGenerator } from './generator.js';
import type { PatchChunk } from './generator.js';
import type { LLMProvider } from '../llm/provider.js';
import type {
  ContextWindow,
  BugReport,
  RootCauseReport,
  ChatMessage,
  LLMOptions,
  PatchSet,
  Patch,
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
    ],
    keywords: ['processData'],
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
    ],
    gitHistory: [
      {
        hash: 'abc1234567890',
        message: 'refactor processData',
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
    totalTokens: 20,
    bugReport: createBugReport(),
    ...overrides,
  };
}

/** Create a minimal RootCauseReport for testing */
function createRootCauseReport(overrides?: Partial<RootCauseReport>): RootCauseReport {
  return {
    candidates: [
      {
        rank: 1,
        confidence: 0.92,
        location: { path: 'src/app.ts', line: 2 },
        description: 'processData accesses property x without null check',
        impact: 'App crashes when data is undefined',
        evidence: [
          { type: 'code-snippet', content: 'return data.x;', source: 'src/app.ts:2' },
        ],
      },
    ],
    summary: 'Missing null check in processData',
    ...overrides,
  };
}

/** Collect all chunks from the async iterable */
async function collectChunks(
  iterable: AsyncIterable<PatchChunk>,
): Promise<PatchChunk[]> {
  const chunks: PatchChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

// ─── Valid LLM Response ──────────────────────────────────────────────────────

const VALID_LLM_RESPONSE = JSON.stringify({
  patches: [
    {
      id: 'patch-1',
      description: 'Add null check before accessing data.x',
      changes: [
        {
          filePath: 'src/app.ts',
          explanation: 'Guard against undefined data parameter',
          hunks: [
            {
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 5,
              content: '@@ -1,3 +1,5 @@\n function processData(data: any) {\n+  if (data == null) {\n+    return undefined;\n+  }\n   return data.x;\n }',
            },
          ],
        },
      ],
      pros: ['Simple and safe fix'],
      cons: ['Returns undefined instead of throwing'],
    },
  ],
  recommended: 0,
});

const MULTI_PATCH_RESPONSE = JSON.stringify({
  patches: [
    {
      id: 'patch-1',
      description: 'Add null check with early return',
      changes: [
        {
          filePath: 'src/app.ts',
          explanation: 'Guard against undefined data',
          hunks: [
            {
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 5,
              content: '@@ -1,3 +1,5 @@\n function processData(data: any) {\n+  if (!data) return undefined;\n   return data.x;\n }',
            },
          ],
        },
      ],
      pros: ['Simple', 'Minimal change'],
      cons: ['Returns undefined silently'],
    },
    {
      id: 'patch-2',
      description: 'Add type guard with descriptive error',
      changes: [
        {
          filePath: 'src/app.ts',
          explanation: 'Throw descriptive error for null data',
          hunks: [
            {
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 5,
              content: '@@ -1,3 +1,5 @@\n function processData(data: any) {\n+  if (!data) throw new Error("data must not be null");\n   return data.x;\n }',
            },
          ],
        },
      ],
      pros: ['Explicit error message', 'Fail-fast behavior'],
      cons: ['Throws instead of graceful handling'],
    },
  ],
  recommended: 1,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PatchGenerator', () => {
  describe('generate', () => {
    it('yields progress, patch, and complete chunks in order', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const chunks = await collectChunks(generator.generate(report, context));

      const types = chunks.map((c) => c.type);
      expect(types.filter((t) => t === 'progress').length).toBeGreaterThanOrEqual(3);
      expect(types.filter((t) => t === 'patch').length).toBe(1);
      expect(types[types.length - 1]).toBe('complete');
    });

    it('yields multiple patch chunks for multi-patch response', async () => {
      const llm = createMockLLM(MULTI_PATCH_RESPONSE);
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const chunks = await collectChunks(
        generator.generate(report, context, { maxPatches: 3, stream: true }),
      );

      const patchChunks = chunks.filter((c) => c.type === 'patch');
      expect(patchChunks.length).toBe(2);
    });

    it('respects maxPatches option', async () => {
      const llm = createMockLLM(MULTI_PATCH_RESPONSE);
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const chunks = await collectChunks(
        generator.generate(report, context, { maxPatches: 1, stream: true }),
      );

      const completeChunk = chunks.find((c) => c.type === 'complete')!;
      const patchSet = completeChunk.data as PatchSet;
      expect(patchSet.patches.length).toBe(1);
    });

    it('uses default options when none provided', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const chunks = await collectChunks(generator.generate(report, context));
      const completeChunk = chunks.find((c) => c.type === 'complete')!;
      const patchSet = completeChunk.data as PatchSet;

      // Default maxPatches is 1, response has 1
      expect(patchSet.patches.length).toBe(1);
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
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      await collectChunks(generator.generate(report, context));

      expect(chatSpy).toHaveBeenCalledOnce();
      const [messages, options] = chatSpy.mock.calls[0] as unknown as [any[], any];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(options?.temperature).toBe(0.2);
    });

    it('complete chunk contains a valid PatchSet', async () => {
      const llm = createMockLLM(VALID_LLM_RESPONSE);
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const chunks = await collectChunks(generator.generate(report, context));
      const completeChunk = chunks.find((c) => c.type === 'complete')!;
      const patchSet = completeChunk.data as PatchSet;

      expect(patchSet.patches).toBeDefined();
      expect(patchSet.recommended).toBeDefined();
      expect(typeof patchSet.recommended).toBe('number');
    });
  });

  describe('buildMessages', () => {
    it('includes root cause analysis in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Root Cause Analysis');
      expect(userContent).toContain('Missing null check in processData');
      expect(userContent).toContain('processData accesses property x without null check');
      expect(userContent).toContain('src/app.ts');
    });

    it('includes candidate evidence in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('code-snippet');
      expect(userContent).toContain('return data.x;');
    });

    it('includes bug report info in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('TypeError');
      expect(userContent).toContain('Cannot read property "x" of undefined');
    });

    it('includes source code context in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Source Code Context');
      expect(userContent).toContain('function processData');
      expect(userContent).toContain('relevance: 0.95');
    });

    it('includes git history in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Git History');
      expect(userContent).toContain('abc1234');
    });

    it('includes project info in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('test-project');
      expect(userContent).toContain('typescript');
    });

    it('system prompt mentions multi-patch with pros/cons when maxPatches > 1', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 3, stream: true });
      const systemContent = messages[0].content;

      expect(systemContent).toContain('3');
      expect(systemContent).toContain('pros');
      expect(systemContent).toContain('cons');
    });

    it('system prompt says exactly 1 patch when maxPatches is 1', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const systemContent = messages[0].content;

      expect(systemContent).toContain('exactly 1 patch');
    });

    it('includes stack trace in user prompt', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport();
      const context = createContextWindow();

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Stack Trace');
      expect(userContent).toContain('src/app.ts:42:10');
    });

    it('handles context without optional fields', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const report = createRootCauseReport({ candidates: [] });
      const context = createContextWindow({
        gitHistory: [],
        files: [],
        bugReport: createBugReport({
          errorType: undefined,
          errorMessage: undefined,
          stackTrace: undefined,
          description: undefined,
        }),
      });

      const messages = generator.buildMessages(report, context, { maxPatches: 1, stream: true });
      const userContent = messages[1].content;

      expect(userContent).toContain('Root Cause Analysis');
      expect(userContent).toContain('Project Info');
    });
  });

  describe('parseResponse', () => {
    it('parses valid JSON response into PatchSet', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(VALID_LLM_RESPONSE, 3);

      expect(patchSet.patches).toHaveLength(1);
      expect(patchSet.recommended).toBe(0);
    });

    it('parses patch id and description', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(VALID_LLM_RESPONSE, 3);
      const patch = patchSet.patches[0];

      expect(patch.id).toBe('patch-1');
      expect(patch.description).toBe('Add null check before accessing data.x');
    });

    it('parses file changes with hunks', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(VALID_LLM_RESPONSE, 3);
      const change = patchSet.patches[0].changes[0];

      expect(change.filePath).toBe('src/app.ts');
      expect(change.explanation).toBe('Guard against undefined data parameter');
      expect(change.hunks).toHaveLength(1);
    });

    it('parses diff hunk fields correctly', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(VALID_LLM_RESPONSE, 3);
      const hunk = patchSet.patches[0].changes[0].hunks[0];

      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldLines).toBe(3);
      expect(hunk.newStart).toBe(1);
      expect(hunk.newLines).toBe(5);
      expect(hunk.content).toContain('@@ -1,3 +1,5 @@');
    });

    it('parses pros and cons', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(VALID_LLM_RESPONSE, 3);
      const patch = patchSet.patches[0];

      expect(patch.pros).toEqual(['Simple and safe fix']);
      expect(patch.cons).toEqual(['Returns undefined instead of throwing']);
    });

    it('parses multiple patches with recommended index', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(MULTI_PATCH_RESPONSE, 3);

      expect(patchSet.patches).toHaveLength(2);
      expect(patchSet.recommended).toBe(1);
      expect(patchSet.patches[0].id).toBe('patch-1');
      expect(patchSet.patches[1].id).toBe('patch-2');
    });

    it('limits patches to maxPatches', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse(MULTI_PATCH_RESPONSE, 1);

      expect(patchSet.patches).toHaveLength(1);
    });

    it('clamps recommended index to valid range', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          {
            id: 'patch-1',
            description: 'Fix',
            changes: [{ filePath: 'a.ts', explanation: 'fix', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '@@ -1,1 +1,1 @@\n-old\n+new' }] }],
          },
        ],
        recommended: 99,
      });

      const patchSet = generator.parseResponse(response, 3);

      expect(patchSet.recommended).toBe(0);
    });

    it('handles JSON wrapped in markdown code block', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const wrapped = '```json\n' + VALID_LLM_RESPONSE + '\n```';

      const patchSet = generator.parseResponse(wrapped, 3);

      expect(patchSet.patches).toHaveLength(1);
      expect(patchSet.patches[0].id).toBe('patch-1');
    });

    it('returns empty patch set for invalid JSON', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);

      const patchSet = generator.parseResponse('not valid json', 3);

      expect(patchSet.patches).toHaveLength(0);
      expect(patchSet.recommended).toBe(0);
    });

    it('skips patches without description', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          { id: 'patch-1', description: '', changes: [{ filePath: 'a.ts', explanation: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '-old\n+new' }] }] },
          { id: 'patch-2', description: 'Valid fix', changes: [{ filePath: 'a.ts', explanation: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '-old\n+new' }] }] },
        ],
        recommended: 0,
      });

      const patchSet = generator.parseResponse(response, 3);

      expect(patchSet.patches).toHaveLength(1);
      expect(patchSet.patches[0].description).toBe('Valid fix');
    });

    it('skips patches without changes', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          { id: 'patch-1', description: 'No changes', changes: [] },
        ],
        recommended: 0,
      });

      const patchSet = generator.parseResponse(response, 3);

      expect(patchSet.patches).toHaveLength(0);
    });

    it('skips file changes without filePath', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          {
            id: 'patch-1',
            description: 'Fix',
            changes: [
              { filePath: '', explanation: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '-old\n+new' }] },
            ],
          },
        ],
        recommended: 0,
      });

      const patchSet = generator.parseResponse(response, 3);

      // Patch is skipped because all its changes are invalid
      expect(patchSet.patches).toHaveLength(0);
    });

    it('skips hunks without content', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          {
            id: 'patch-1',
            description: 'Fix',
            changes: [
              { filePath: 'a.ts', explanation: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '' }] },
            ],
          },
        ],
        recommended: 0,
      });

      const patchSet = generator.parseResponse(response, 3);

      // Patch is skipped because file change has no valid hunks
      expect(patchSet.patches).toHaveLength(0);
    });

    it('assigns default id when missing', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          {
            description: 'Fix without id',
            changes: [{ filePath: 'a.ts', explanation: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '-old\n+new' }] }],
          },
        ],
        recommended: 0,
      });

      const patchSet = generator.parseResponse(response, 3);

      expect(patchSet.patches[0].id).toBe('patch-1');
    });

    it('handles missing pros/cons gracefully', () => {
      const llm = createMockLLM('');
      const generator = new PatchGenerator(llm);
      const response = JSON.stringify({
        patches: [
          {
            id: 'patch-1',
            description: 'Fix',
            changes: [{ filePath: 'a.ts', explanation: 'x', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '-old\n+new' }] }],
          },
        ],
        recommended: 0,
      });

      const patchSet = generator.parseResponse(response, 3);

      expect(patchSet.patches[0].pros).toBeUndefined();
      expect(patchSet.patches[0].cons).toBeUndefined();
    });
  });
});
