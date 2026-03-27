import { describe, it, expect, vi } from 'vitest';
import { Pipeline, PipelineError } from './pipeline.js';
import type { PipelineConfig, PipelineDeps } from './pipeline.js';
import type { BugReport, RootCauseReport, Patch, ContextWindow } from './types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockBugReport: BugReport = {
  rawInput: 'TypeError in src/app.ts:10',
  source: 'cli-arg',
  errorType: 'TypeError',
  errorMessage: 'Cannot read property',
  filePaths: [{ path: 'src/app.ts', line: 10 }],
  stackTrace: [],
  keywords: ['app.ts'],
};

const mockContextWindow: ContextWindow = {
  files: [],
  gitHistory: [],
  projectInfo: { name: 'test', language: 'typescript', dependencies: {}, configFiles: [] },
  totalTokens: 100,
  bugReport: mockBugReport,
};

const mockRootCauseReport: RootCauseReport = {
  candidates: [
    {
      rank: 1,
      confidence: 0.9,
      location: { path: 'src/app.ts', line: 10 },
      description: 'Null reference',
      impact: 'Crash on startup',
      evidence: [],
    },
  ],
  summary: 'Null reference at line 10',
};

const mockPatch: Patch = {
  id: 'patch-1',
  description: 'Add null check',
  changes: [
    {
      filePath: 'src/app.ts',
      hunks: [{ oldStart: 10, oldLines: 1, newStart: 10, newLines: 2, content: '@@ -10,1 +10,2 @@\n-old\n+new\n+added' }],
      explanation: 'Added null check',
    },
  ],
};

const defaultConfig: PipelineConfig = {
  contextLimit: 8000,
  repoPath: '/repo',
  gitHistoryDepth: 10,
  ignorePatterns: [],
  apply: false,
  dryRun: false,
};

function createMockDeps(overrides?: Partial<PipelineDeps>): PipelineDeps {
  return {
    inputParser: {
      parse: vi.fn().mockReturnValue({ success: true, data: mockBugReport }),
      validate: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
    } as any,
    contextCollector: {
      collect: vi.fn().mockResolvedValue(mockContextWindow),
    } as any,
    rootCauseAnalyzer: {
      analyze: vi.fn().mockReturnValue(
        (async function* () {
          yield { type: 'progress', data: 'Analyzing...' };
          yield { type: 'complete', data: mockRootCauseReport };
        })(),
      ),
    } as any,
    patchGenerator: {
      generate: vi.fn().mockReturnValue(
        (async function* () {
          yield { type: 'progress', data: 'Generating...' };
          yield { type: 'patch', data: mockPatch };
          yield { type: 'complete', data: { patches: [mockPatch], recommended: 0 } };
        })(),
      ),
    } as any,
    outputFormatter: {
      formatAnalysis: vi.fn().mockReturnValue('Analysis output'),
      formatPatch: vi.fn().mockReturnValue('Patch output'),
      formatApplyResult: vi.fn().mockReturnValue('Apply output'),
    } as any,
    patchApplier: {
      apply: vi.fn().mockResolvedValue({ success: true, filesModified: ['src/app.ts'], linesAdded: 1, linesDeleted: 1 }),
      preview: vi.fn().mockResolvedValue({ success: true, filesModified: ['src/app.ts'], linesAdded: 1, linesDeleted: 1 }),
    } as any,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Pipeline', () => {
  describe('fix', () => {
    it('runs the full pipeline and returns formatted output', async () => {
      const deps = createMockDeps();
      const pipeline = new Pipeline(deps);

      const result = await pipeline.fix('TypeError in src/app.ts:10', 'cli-arg', defaultConfig);

      expect(deps.inputParser.parse).toHaveBeenCalledWith('TypeError in src/app.ts:10', 'cli-arg');
      expect(deps.contextCollector.collect).toHaveBeenCalledWith(mockBugReport, {
        maxTokens: 8000,
        repoPath: '/repo',
        gitHistoryDepth: 10,
        ignorePatterns: [],
      });
      expect(deps.rootCauseAnalyzer.analyze).toHaveBeenCalledWith(mockContextWindow, mockBugReport);
      expect(deps.patchGenerator.generate).toHaveBeenCalledWith(mockRootCauseReport, mockContextWindow);
      expect(deps.outputFormatter.formatAnalysis).toHaveBeenCalledWith(mockRootCauseReport);
      expect(deps.outputFormatter.formatPatch).toHaveBeenCalledWith(mockPatch);
      expect(result).toContain('Analysis output');
      expect(result).toContain('Patch output');
    });

    it('applies patch when config.apply is true', async () => {
      const deps = createMockDeps();
      const pipeline = new Pipeline(deps);

      const result = await pipeline.fix('error', 'cli-arg', { ...defaultConfig, apply: true });

      expect(deps.patchApplier.apply).toHaveBeenCalledWith(mockPatch, '/repo');
      expect(deps.outputFormatter.formatApplyResult).toHaveBeenCalled();
      expect(result).toContain('Apply output');
    });

    it('previews patch when config.dryRun is true', async () => {
      const deps = createMockDeps();
      const pipeline = new Pipeline(deps);

      const result = await pipeline.fix('error', 'cli-arg', { ...defaultConfig, dryRun: true });

      expect(deps.patchApplier.preview).toHaveBeenCalledWith(mockPatch, '/repo');
      expect(deps.outputFormatter.formatApplyResult).toHaveBeenCalled();
      expect(result).toContain('Apply output');
    });

    it('does not apply or preview when both flags are false', async () => {
      const deps = createMockDeps();
      const pipeline = new Pipeline(deps);

      await pipeline.fix('error', 'cli-arg', defaultConfig);

      expect(deps.patchApplier.apply).not.toHaveBeenCalled();
      expect(deps.patchApplier.preview).not.toHaveBeenCalled();
    });

    it('throws PipelineError on parse failure', async () => {
      const deps = createMockDeps({
        inputParser: {
          parse: vi.fn().mockReturnValue({
            success: false,
            errors: [{ field: 'rawInput', message: 'Input is empty' }],
          }),
          validate: vi.fn(),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.fix('', 'cli-arg', defaultConfig)).rejects.toThrow(PipelineError);
      await expect(pipeline.fix('', 'cli-arg', defaultConfig)).rejects.toThrow('Failed to parse input');
    });

    it('throws PipelineError on context collection failure', async () => {
      const deps = createMockDeps({
        contextCollector: {
          collect: vi.fn().mockRejectedValue(new Error('disk error')),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.fix('error', 'cli-arg', defaultConfig)).rejects.toThrow(PipelineError);
      await expect(pipeline.fix('error', 'cli-arg', defaultConfig)).rejects.toThrow('disk error');
    });

    it('throws PipelineError on analysis failure', async () => {
      const deps = createMockDeps({
        rootCauseAnalyzer: {
          analyze: vi.fn().mockReturnValue(
            (async function* () {
              throw new Error('LLM timeout');
            })(),
          ),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.fix('error', 'cli-arg', defaultConfig)).rejects.toThrow('LLM timeout');
    });

    it('throws PipelineError when analysis produces no report', async () => {
      const deps = createMockDeps({
        rootCauseAnalyzer: {
          analyze: vi.fn().mockReturnValue(
            (async function* () {
              yield { type: 'progress', data: 'working...' };
            })(),
          ),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.fix('error', 'cli-arg', defaultConfig)).rejects.toThrow(
        'Root cause analysis produced no report',
      );
    });

    it('throws PipelineError on patch generation failure', async () => {
      const deps = createMockDeps({
        patchGenerator: {
          generate: vi.fn().mockReturnValue(
            (async function* () {
              throw new Error('generation failed');
            })(),
          ),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.fix('error', 'cli-arg', defaultConfig)).rejects.toThrow('generation failed');
    });
  });

  describe('analyze', () => {
    it('runs parse → collect → analyze → format (no patch generation)', async () => {
      const deps = createMockDeps();
      const pipeline = new Pipeline(deps);

      const result = await pipeline.analyze('TypeError in src/app.ts:10', 'cli-arg', defaultConfig);

      expect(deps.inputParser.parse).toHaveBeenCalled();
      expect(deps.contextCollector.collect).toHaveBeenCalled();
      expect(deps.rootCauseAnalyzer.analyze).toHaveBeenCalled();
      expect(deps.outputFormatter.formatAnalysis).toHaveBeenCalledWith(mockRootCauseReport);
      // Should NOT call patch generator or applier
      expect(deps.patchGenerator.generate).not.toHaveBeenCalled();
      expect(deps.patchApplier.apply).not.toHaveBeenCalled();
      expect(result).toBe('Analysis output');
    });

    it('throws PipelineError on parse failure', async () => {
      const deps = createMockDeps({
        inputParser: {
          parse: vi.fn().mockReturnValue({
            success: false,
            errors: [{ field: 'rawInput', message: 'Input is empty' }],
          }),
          validate: vi.fn(),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.analyze('', 'cli-arg', defaultConfig)).rejects.toThrow(PipelineError);
    });

    it('throws PipelineError on context collection failure', async () => {
      const deps = createMockDeps({
        contextCollector: {
          collect: vi.fn().mockRejectedValue(new Error('no repo')),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.analyze('error', 'cli-arg', defaultConfig)).rejects.toThrow('no repo');
    });

    it('throws PipelineError when analysis produces no report', async () => {
      const deps = createMockDeps({
        rootCauseAnalyzer: {
          analyze: vi.fn().mockReturnValue(
            (async function* () {
              yield { type: 'progress', data: 'working...' };
            })(),
          ),
        } as any,
      });
      const pipeline = new Pipeline(deps);

      await expect(pipeline.analyze('error', 'cli-arg', defaultConfig)).rejects.toThrow(
        'Root cause analysis produced no report',
      );
    });
  });

  describe('PipelineError', () => {
    it('has the correct stage and message', () => {
      const err = new PipelineError('parse', 'bad input');
      expect(err.stage).toBe('parse');
      expect(err.message).toBe('bad input');
      expect(err.name).toBe('PipelineError');
      expect(err).toBeInstanceOf(Error);
    });
  });
});
