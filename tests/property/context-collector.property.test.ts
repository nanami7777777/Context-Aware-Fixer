import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  ContextCollector,
  defaultTokenEstimator,
  type ContextConfig,
  type FileReader,
} from '../../src/context/collector.js';
import type { GitProvider } from '../../src/context/git-provider.js';
import type { ASTParser } from '../../src/context/ast-parser.js';
import type { DependencyResolver } from '../../src/context/dependency-resolver.js';
import { RelevanceScorer } from '../../src/context/relevance-scorer.js';
import type { BugReport } from '../../src/types.js';

/**
 * Property P3: 上下文窗口 Token 限制
 * ∀ contextWindow ∈ ContextWindow, limit ∈ PositiveInteger:
 *   collect(report, {maxTokens: limit}).totalTokens <= limit
 *
 * **Validates: Requirements 2.5**
 */

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockGitProvider(): GitProvider {
  return {
    getFileHistory: vi.fn().mockResolvedValue([]),
    getBlame: vi.fn().mockResolvedValue([]),
    isIgnored: vi.fn().mockResolvedValue(false),
  } as unknown as GitProvider;
}

function createMockASTParser(): ASTParser {
  return {
    parse: vi.fn().mockReturnValue(null),
    extractImports: vi.fn().mockReturnValue([]),
  } as unknown as ASTParser;
}

function createMockDependencyResolver(): DependencyResolver {
  return {
    buildGraph: vi.fn(),
    getDependencies: vi.fn().mockReturnValue([]),
    getTransitiveDependencies: vi.fn().mockReturnValue([]),
    getImportDepth: vi.fn().mockReturnValue(-1),
    getGraph: vi.fn().mockReturnValue(new Map()),
  } as unknown as DependencyResolver;
}

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn().mockImplementation(async (p: string) => {
      if (p in files) return files[p];
      throw new Error(`File not found: ${p}`);
    }),
    exists: vi.fn().mockImplementation(async (p: string) => p in files),
    listFiles: vi.fn().mockResolvedValue(Object.keys(files)),
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a positive token limit (1 to 10000) */
const maxTokensArb = fc.integer({ min: 1, max: 10000 });

/**
 * Generate a list of file entries: each has a relative path and content.
 * Content length is bounded so the test runs quickly.
 */
const fileEntriesArb = fc.array(
  fc.record({
    relativePath: fc.stringMatching(/^src\/[a-z]{1,8}\.(ts|js|py)$/),
    content: fc.string({ minLength: 1, maxLength: 400 }),
  }),
  { minLength: 1, maxLength: 8 },
);

// ─── Property Test ───────────────────────────────────────────────────────────

/**
 * Property P9: .gitignore 过滤一致性
 * ∀ file ∈ ContextWindow.files: isIgnored(file.path) == false
 *
 * **Validates: Requirements 2.6**
 */

/**
 * Generate a list of file entries where each file is randomly marked as ignored or not.
 */
const fileEntriesWithIgnoredArb = fc.array(
  fc.record({
    relativePath: fc.stringMatching(/^src\/[a-z]{1,8}\.(ts|js|py)$/),
    content: fc.string({ minLength: 1, maxLength: 400 }),
    ignored: fc.boolean(),
  }),
  { minLength: 1, maxLength: 8 },
);

/** Create a GitProvider mock where isIgnored returns true for paths in the ignored set */
function createMockGitProviderWithIgnored(ignoredPaths: Set<string>): GitProvider {
  return {
    getFileHistory: vi.fn().mockResolvedValue([]),
    getBlame: vi.fn().mockResolvedValue([]),
    isIgnored: vi.fn().mockImplementation(async (p: string) => ignoredPaths.has(p)),
  } as unknown as GitProvider;
}

describe('ContextCollector Property Tests', () => {
  it('P3: totalTokens never exceeds maxTokens for arbitrary limits and files', async () => {
    await fc.assert(
      fc.asyncProperty(maxTokensArb, fileEntriesArb, async (maxTokens, fileEntries) => {
        // Deduplicate paths
        const seen = new Set<string>();
        const uniqueEntries = fileEntries.filter((e) => {
          if (seen.has(e.relativePath)) return false;
          seen.add(e.relativePath);
          return true;
        });

        const repoPath = '/repo';

        // Build file map with absolute paths
        const files: Record<string, string> = {};
        for (const entry of uniqueEntries) {
          files[`${repoPath}/${entry.relativePath}`] = entry.content;
        }

        // Build a BugReport that references all generated files
        const report: BugReport = {
          rawInput: 'error in generated files',
          source: 'cli-arg',
          filePaths: uniqueEntries.map((e) => ({ path: e.relativePath })),
          stackTrace: [],
          keywords: [],
        };

        const config: ContextConfig = {
          maxTokens,
          repoPath,
          gitHistoryDepth: 5,
          ignorePatterns: [],
        };

        const collector = new ContextCollector(
          createMockGitProvider(),
          createMockASTParser(),
          createMockDependencyResolver(),
          new RelevanceScorer(),
          createMockFileReader(files),
          defaultTokenEstimator,
        );

        const result = await collector.collect(report, config);

        expect(result.totalTokens).toBeLessThanOrEqual(maxTokens);
      }),
      { numRuns: 100 },
    );
  });

  it('P9: ignored files never appear in ContextWindow.files', async () => {
    await fc.assert(
      fc.asyncProperty(fileEntriesWithIgnoredArb, async (fileEntries) => {
        // Deduplicate paths
        const seen = new Set<string>();
        const uniqueEntries = fileEntries.filter((e) => {
          if (seen.has(e.relativePath)) return false;
          seen.add(e.relativePath);
          return true;
        });

        const repoPath = '/repo';

        // Build file map with absolute paths (all files exist on disk)
        const files: Record<string, string> = {};
        for (const entry of uniqueEntries) {
          files[`${repoPath}/${entry.relativePath}`] = entry.content;
        }

        // Collect the set of relative paths that are marked as ignored
        const ignoredRelativePaths = new Set(
          uniqueEntries.filter((e) => e.ignored).map((e) => e.relativePath),
        );

        // Build a BugReport that references ALL files (both ignored and non-ignored)
        const report: BugReport = {
          rawInput: 'error in generated files',
          source: 'cli-arg',
          filePaths: uniqueEntries.map((e) => ({ path: e.relativePath })),
          stackTrace: [],
          keywords: [],
        };

        const config: ContextConfig = {
          maxTokens: 100000,
          repoPath,
          gitHistoryDepth: 5,
          ignorePatterns: [],
        };

        const collector = new ContextCollector(
          createMockGitProviderWithIgnored(ignoredRelativePaths),
          createMockASTParser(),
          createMockDependencyResolver(),
          new RelevanceScorer(),
          createMockFileReader(files),
          defaultTokenEstimator,
        );

        const result = await collector.collect(report, config);

        // Verify: no file in the result should be one of the ignored paths
        for (const file of result.files) {
          expect(ignoredRelativePaths.has(file.path)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
