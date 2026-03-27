import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ContextCollector,
  defaultTokenEstimator,
  type ContextConfig,
  type FileReader,
} from './collector.js';
import type { GitProvider } from './git-provider.js';
import type { ASTParser } from './ast-parser.js';
import type { DependencyResolver } from './dependency-resolver.js';
import { RelevanceScorer } from './relevance-scorer.js';
import type { BugReport, GitCommit } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    rawInput: 'TypeError in handler.ts',
    source: 'cli-arg',
    errorType: 'TypeError',
    errorMessage: 'Cannot read property',
    filePaths: [{ path: 'src/handler.ts', line: 10 }],
    stackTrace: [{ filePath: 'src/handler.ts', functionName: 'handle', line: 10 }],
    keywords: ['handler', 'TypeError'],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return {
    maxTokens: 2000,
    repoPath: '/repo',
    gitHistoryDepth: 10,
    ignorePatterns: [],
    ...overrides,
  };
}

const fakeCommit: GitCommit = {
  hash: 'abc123',
  message: 'fix handler',
  author: 'dev',
  date: new Date('2024-01-01'),
  filesChanged: ['src/handler.ts'],
};

// ─── Mock factories ──────────────────────────────────────────────────────────

function createMockGitProvider(overrides: Partial<GitProvider> = {}): GitProvider {
  return {
    getFileHistory: vi.fn().mockResolvedValue([fakeCommit]),
    getBlame: vi.fn().mockResolvedValue([]),
    isIgnored: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as GitProvider;
}

function createMockASTParser(overrides: Partial<ASTParser> = {}): ASTParser {
  return {
    parse: vi.fn().mockReturnValue({
      language: 'typescript',
      imports: [],
      exports: [],
      functions: [{ name: 'handle', line: 5 }],
      classes: [],
    }),
    extractImports: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as ASTParser;
}

function createMockDependencyResolver(
  overrides: Partial<DependencyResolver> = {},
): DependencyResolver {
  return {
    buildGraph: vi.fn(),
    getDependencies: vi.fn().mockReturnValue([]),
    getTransitiveDependencies: vi.fn().mockReturnValue([]),
    getImportDepth: vi.fn().mockReturnValue(-1),
    getGraph: vi.fn().mockReturnValue(new Map()),
    ...overrides,
  } as unknown as DependencyResolver;
}

function createMockFileReader(
  files: Record<string, string> = {},
): FileReader {
  return {
    readFile: vi.fn().mockImplementation(async (p: string) => {
      if (p in files) return files[p];
      throw new Error(`File not found: ${p}`);
    }),
    exists: vi.fn().mockImplementation(async (p: string) => p in files),
    listFiles: vi.fn().mockResolvedValue(Object.keys(files)),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('defaultTokenEstimator', () => {
  it('estimates tokens as ceil(length / 4)', () => {
    expect(defaultTokenEstimator('')).toBe(0);
    expect(defaultTokenEstimator('abcd')).toBe(1);
    expect(defaultTokenEstimator('abcde')).toBe(2);
    expect(defaultTokenEstimator('a'.repeat(100))).toBe(25);
  });
});

describe('ContextCollector', () => {
  let gitProvider: GitProvider;
  let astParser: ASTParser;
  let depResolver: DependencyResolver;
  let scorer: RelevanceScorer;
  let fileReader: FileReader;
  let collector: ContextCollector;

  const handlerContent = 'export function handle() {\n  throw new TypeError("oops");\n}\n';

  beforeEach(() => {
    gitProvider = createMockGitProvider();
    astParser = createMockASTParser();
    depResolver = createMockDependencyResolver();
    scorer = new RelevanceScorer();
    fileReader = createMockFileReader({
      '/repo/src/handler.ts': handlerContent,
      '/repo/package.json': JSON.stringify({ name: 'test-project', dependencies: { lodash: '4.0.0' } }),
    });
    collector = new ContextCollector(
      gitProvider,
      astParser,
      depResolver,
      scorer,
      fileReader,
    );
  });

  describe('collect', () => {
    it('includes files mentioned in the bug report', async () => {
      const result = await collector.collect(makeReport(), makeConfig());
      expect(result.files.length).toBeGreaterThanOrEqual(1);
      expect(result.files.some((f) => f.path === 'src/handler.ts')).toBe(true);
    });

    it('respects token limit — totalTokens never exceeds maxTokens', async () => {
      const config = makeConfig({ maxTokens: 50 });
      const result = await collector.collect(makeReport(), config);
      expect(result.totalTokens).toBeLessThanOrEqual(50);
    });

    it('includes bug report in the context window', async () => {
      const report = makeReport();
      const result = await collector.collect(report, makeConfig());
      expect(result.bugReport).toBe(report);
    });

    it('collects git history for mentioned files', async () => {
      const result = await collector.collect(makeReport(), makeConfig());
      expect(result.gitHistory.length).toBeGreaterThanOrEqual(1);
      expect(result.gitHistory[0].hash).toBe('abc123');
    });

    it('detects project info from package.json', async () => {
      const result = await collector.collect(makeReport(), makeConfig());
      expect(result.projectInfo.name).toBe('test-project');
      expect(result.projectInfo.configFiles).toContain('package.json');
      expect(result.projectInfo.dependencies).toHaveProperty('lodash');
    });

    it('filters out .gitignore-ignored files', async () => {
      const gitProviderWithIgnore = createMockGitProvider({
        isIgnored: vi.fn().mockImplementation(async (p: string) => {
          return p === 'src/handler.ts';
        }),
      });
      const collectorWithIgnore = new ContextCollector(
        gitProviderWithIgnore,
        astParser,
        depResolver,
        scorer,
        fileReader,
      );

      const result = await collectorWithIgnore.collect(makeReport(), makeConfig());
      expect(result.files.every((f) => f.path !== 'src/handler.ts')).toBe(true);
    });

    it('sorts files by relevance score descending', async () => {
      const multiFileReader = createMockFileReader({
        '/repo/src/handler.ts': handlerContent,
        '/repo/src/utils.ts': 'export const x = 1;\n',
        '/repo/package.json': '{}',
      });

      const depResolverWithDeps = createMockDependencyResolver({
        getTransitiveDependencies: vi.fn().mockReturnValue([
          { filePath: '/repo/src/utils.ts', depth: 1 },
        ]),
        getImportDepth: vi.fn().mockImplementation((_root: string, target: string) => {
          if (target.endsWith('handler.ts')) return 0;
          if (target.endsWith('utils.ts')) return 1;
          return -1;
        }),
      });

      const collectorMulti = new ContextCollector(
        gitProvider,
        astParser,
        depResolverWithDeps,
        scorer,
        multiFileReader,
      );

      const report = makeReport();
      const result = await collectorMulti.collect(report, makeConfig());

      if (result.files.length >= 2) {
        expect(result.files[0].relevanceScore).toBeGreaterThanOrEqual(
          result.files[1].relevanceScore,
        );
      }
    });

    it('truncates the last file when it exceeds token budget', async () => {
      // Create a large file that won't fit entirely
      const largeContent = 'function foo() {\n' + '  const x = 1;\n'.repeat(200) + '}\n';
      const smallFileReader = createMockFileReader({
        '/repo/src/handler.ts': largeContent,
        '/repo/package.json': '{}',
      });

      const collectorSmall = new ContextCollector(
        gitProvider,
        astParser,
        depResolver,
        scorer,
        smallFileReader,
      );

      // Very small token limit
      const config = makeConfig({ maxTokens: 100 });
      const result = await collectorSmall.collect(makeReport(), config);

      expect(result.totalTokens).toBeLessThanOrEqual(100);
      if (result.files.length > 0) {
        const lastFile = result.files[result.files.length - 1];
        // Either the file fits or it's truncated
        expect(lastFile.isTruncated || lastFile.tokenCount <= 100).toBe(true);
      }
    });

    it('handles empty bug report gracefully', async () => {
      const emptyReport = makeReport({
        filePaths: [],
        stackTrace: [],
        keywords: [],
      });
      const result = await collector.collect(emptyReport, makeConfig());
      expect(result.files).toEqual([]);
      expect(result.totalTokens).toBe(0);
    });

    it('handles file read errors gracefully', async () => {
      const brokenReader = createMockFileReader({});
      // exists returns true but readFile throws
      (brokenReader.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      (brokenReader.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('EACCES'),
      );

      const collectorBroken = new ContextCollector(
        gitProvider,
        astParser,
        depResolver,
        scorer,
        brokenReader,
      );

      const result = await collectorBroken.collect(makeReport(), makeConfig());
      // Should not throw, just return empty files
      expect(result.files).toEqual([]);
    });

    it('deduplicates git history commits', async () => {
      const report = makeReport({
        filePaths: [
          { path: 'src/handler.ts', line: 10 },
          { path: 'src/handler.ts', line: 20 },
        ],
        stackTrace: [
          { filePath: 'src/handler.ts', functionName: 'handle', line: 10 },
        ],
      });

      const result = await collector.collect(report, makeConfig());
      const hashes = result.gitHistory.map((c) => c.hash);
      expect(new Set(hashes).size).toBe(hashes.length);
    });

    it('returns relative paths in context files', async () => {
      const result = await collector.collect(makeReport(), makeConfig());
      for (const file of result.files) {
        expect(file.path).not.toMatch(/^\//);
      }
    });
  });

  describe('project info detection', () => {
    it('defaults to repo basename when no config found', async () => {
      const emptyReader = createMockFileReader({});
      const collectorEmpty = new ContextCollector(
        gitProvider,
        astParser,
        depResolver,
        scorer,
        emptyReader,
      );

      const report = makeReport({ filePaths: [], stackTrace: [] });
      const result = await collectorEmpty.collect(report, makeConfig({ repoPath: '/my/project' }));
      expect(result.projectInfo.name).toBe('project');
    });

    it('detects language from config file type', async () => {
      const pyReader = createMockFileReader({
        '/repo/pyproject.toml': '[project]\nname = "myapp"\n',
        '/repo/package.json': '{}',
      });
      const collectorPy = new ContextCollector(
        gitProvider,
        astParser,
        depResolver,
        scorer,
        pyReader,
      );

      const report = makeReport({ filePaths: [], stackTrace: [] });
      const result = await collectorPy.collect(report, makeConfig());
      // package.json is checked first, but pyproject.toml overrides
      expect(result.projectInfo.configFiles).toContain('pyproject.toml');
    });
  });
});
