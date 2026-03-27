import * as path from 'node:path';
import type {
  BugReport,
  ContextWindow,
  ContextFile,
  GitCommit,
  ProjectInfo,
  SupportedLanguage,
} from '../types.js';
import type { GitProvider } from './git-provider.js';
import type { ASTParser } from './ast-parser.js';
import type { DependencyResolver } from './dependency-resolver.js';
import { RelevanceScorer, type CandidateFile, type FileMetadata } from './relevance-scorer.js';

/** Configuration for context collection */
export interface ContextConfig {
  maxTokens: number;
  repoPath: string;
  gitHistoryDepth: number;
  ignorePatterns: string[];
}

/** File reader abstraction for testability */
export interface FileReader {
  readFile(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
  listFiles(dirPath: string): Promise<string[]>;
}

/** Token estimator function signature */
export type TokenEstimator = (text: string) => number;

/** Simple word-based token estimator (≈ 4 chars per token) */
export function defaultTokenEstimator(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Known project config files and their associated languages */
const PROJECT_CONFIG_FILES: Array<{
  filename: string;
  language: SupportedLanguage;
  packageManager?: string;
}> = [
  { filename: 'package.json', language: 'typescript', packageManager: 'npm' },
  { filename: 'pyproject.toml', language: 'python', packageManager: 'pip' },
  { filename: 'Cargo.toml', language: 'rust', packageManager: 'cargo' },
  { filename: 'go.mod', language: 'go', packageManager: 'go' },
  { filename: 'pom.xml', language: 'java', packageManager: 'maven' },
  { filename: 'build.gradle', language: 'java', packageManager: 'gradle' },
];

/**
 * Collects and assembles a context window for bug analysis.
 *
 * Integrates GitProvider, ASTParser, DependencyResolver, and RelevanceScorer
 * to gather, score, and trim files into a token-limited context window.
 */
export class ContextCollector {
  constructor(
    private gitProvider: GitProvider,
    private astParser: ASTParser,
    private dependencyResolver: DependencyResolver,
    private scorer: RelevanceScorer,
    private fileReader: FileReader,
    private estimateTokens: TokenEstimator = defaultTokenEstimator,
  ) {}

  /**
   * Collect context for a bug report within the configured token budget.
   *
   * Steps:
   * 1. Read files mentioned in the BugReport
   * 2. Use ASTParser to extract imports and build dependency graph
   * 3. Use GitProvider to get file history and filter .gitignore'd files
   * 4. Use RelevanceScorer to score all candidate files
   * 5. Sort by relevance score descending
   * 6. Add files to ContextWindow until token limit is reached
   * 7. For the last file that exceeds the limit, truncate to function-level
   * 8. Read project config files for ProjectInfo
   */
  async collect(report: BugReport, config: ContextConfig): Promise<ContextWindow> {
    // 1. Gather candidate file paths from the report
    const mentionedPaths = this.extractMentionedPaths(report, config.repoPath);
    const stackTracePaths = this.extractStackTracePaths(report, config.repoPath);

    // Read mentioned files and build file content map
    const allMentionedPaths = [...new Set([...mentionedPaths, ...stackTracePaths])];
    const fileContents = new Map<string, string>();

    for (const filePath of allMentionedPaths) {
      try {
        if (await this.fileReader.exists(filePath)) {
          const ignored = await this.gitProvider.isIgnored(
            path.relative(config.repoPath, filePath),
          );
          if (!ignored) {
            const content = await this.fileReader.readFile(filePath);
            fileContents.set(filePath, content);
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // 2. Build dependency graph from known files
    this.dependencyResolver.buildGraph(fileContents);

    // Collect transitive dependencies
    const depPaths = new Set<string>();
    for (const filePath of fileContents.keys()) {
      const deps = this.dependencyResolver.getTransitiveDependencies(filePath, 3);
      for (const dep of deps) {
        depPaths.add(dep.filePath);
      }
    }

    // Read dependency files not yet loaded
    for (const depPath of depPaths) {
      if (!fileContents.has(depPath)) {
        try {
          if (await this.fileReader.exists(depPath)) {
            const ignored = await this.gitProvider.isIgnored(
              path.relative(config.repoPath, depPath),
            );
            if (!ignored) {
              const content = await this.fileReader.readFile(depPath);
              fileContents.set(depPath, content);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Rebuild graph with all files
    this.dependencyResolver.buildGraph(fileContents);

    // 3. Collect git history for mentioned files
    const gitHistory: GitCommit[] = [];
    const seenHashes = new Set<string>();
    for (const filePath of allMentionedPaths) {
      try {
        const relativePath = path.relative(config.repoPath, filePath);
        const history = await this.gitProvider.getFileHistory(
          relativePath,
          config.gitHistoryDepth,
        );
        for (const commit of history) {
          if (!seenHashes.has(commit.hash)) {
            seenHashes.add(commit.hash);
            gitHistory.push(commit);
          }
        }
      } catch {
        // Skip files with no git history
      }
    }

    // 4. Score all candidate files
    const mentionedSet = new Set(mentionedPaths);
    const stackTraceSet = new Set(stackTracePaths);

    const candidates: CandidateFile[] = [];
    for (const [filePath, content] of fileContents) {
      const tokenCount = this.estimateTokens(content);
      const importDepth = this.computeMinImportDepth(filePath, mentionedPaths);
      const recentCommitCount = await this.getRecentCommitCount(
        filePath,
        config.repoPath,
        config.gitHistoryDepth,
      );

      const metadata: FileMetadata = {
        mentionedInReport: mentionedSet.has(filePath),
        importDepth,
        recentCommitCount,
        hasErrorTrace: stackTraceSet.has(filePath),
      };

      candidates.push({ path: filePath, content, tokenCount, metadata });
    }

    // Score and sort by relevance descending
    const scored = candidates.map((c) => ({
      candidate: c,
      score: this.scorer.score(c, report),
    }));
    scored.sort((a, b) => b.score - a.score);

    // 5-7. Fill context window within token budget
    const contextFiles: ContextFile[] = [];
    let totalTokens = 0;

    for (const { candidate, score } of scored) {
      if (totalTokens + candidate.tokenCount <= config.maxTokens) {
        // File fits entirely
        contextFiles.push({
          path: path.relative(config.repoPath, candidate.path),
          content: candidate.content,
          relevanceScore: score,
          tokenCount: candidate.tokenCount,
          isTruncated: false,
        });
        totalTokens += candidate.tokenCount;
      } else {
        // Try to truncate to function-level granularity
        const remainingTokens = config.maxTokens - totalTokens;
        if (remainingTokens > 0) {
          const truncated = this.truncateToFunctionLevel(
            candidate.content,
            candidate.path,
            remainingTokens,
            report,
          );
          if (truncated) {
            const truncTokens = this.estimateTokens(truncated);
            contextFiles.push({
              path: path.relative(config.repoPath, candidate.path),
              content: truncated,
              relevanceScore: score,
              tokenCount: truncTokens,
              isTruncated: true,
              truncationReason: 'Truncated to function-level to fit token limit',
            });
            totalTokens += truncTokens;
          }
        }
        break; // Token budget exhausted
      }
    }

    // 8. Read project info
    const projectInfo = await this.detectProjectInfo(config.repoPath);

    return {
      files: contextFiles,
      gitHistory,
      projectInfo,
      totalTokens,
      bugReport: report,
    };
  }

  /** Extract absolute file paths mentioned in the bug report */
  private extractMentionedPaths(report: BugReport, repoPath: string): string[] {
    return report.filePaths.map((ref) => path.resolve(repoPath, ref.path));
  }

  /** Extract absolute file paths from stack trace */
  private extractStackTracePaths(report: BugReport, repoPath: string): string[] {
    if (!report.stackTrace) return [];
    return report.stackTrace.map((frame) => path.resolve(repoPath, frame.filePath));
  }

  /** Compute the minimum import depth from any mentioned file to the target */
  private computeMinImportDepth(targetPath: string, mentionedPaths: string[]): number {
    if (mentionedPaths.length === 0) return 999;

    let minDepth = 999;
    for (const rootPath of mentionedPaths) {
      const depth = this.dependencyResolver.getImportDepth(rootPath, targetPath);
      if (depth >= 0 && depth < minDepth) {
        minDepth = depth;
      }
    }
    return minDepth;
  }

  /** Get recent commit count for a file */
  private async getRecentCommitCount(
    filePath: string,
    repoPath: string,
    limit: number,
  ): Promise<number> {
    try {
      const relativePath = path.relative(repoPath, filePath);
      const history = await this.gitProvider.getFileHistory(relativePath, limit);
      return history.length;
    } catch {
      return 0;
    }
  }

  /**
   * Truncate file content to function/class-level granularity.
   *
   * Extracts functions and classes from the file using the AST parser,
   * then selects the most relevant blocks that fit within the token budget.
   * Prioritizes blocks that contain lines referenced in the bug report.
   */
  private truncateToFunctionLevel(
    content: string,
    filePath: string,
    maxTokens: number,
    report: BugReport,
  ): string | null {
    const astInfo = this.astParser.parse(filePath, content);
    if (!astInfo) {
      // No AST available — fall back to simple line truncation
      return this.truncateByLines(content, maxTokens);
    }

    const lines = content.split('\n');

    // Collect all function/class blocks with their line ranges
    const blocks: Array<{ name: string; startLine: number; content: string }> = [];

    for (const fn of astInfo.functions) {
      const blockContent = this.extractBlock(lines, fn.line);
      if (blockContent) {
        blocks.push({ name: fn.name, startLine: fn.line, content: blockContent });
      }
    }

    for (const cls of astInfo.classes) {
      const blockContent = this.extractBlock(lines, cls.line);
      if (blockContent) {
        blocks.push({ name: cls.name, startLine: cls.line, content: blockContent });
      }
    }

    if (blocks.length === 0) {
      return this.truncateByLines(content, maxTokens);
    }

    // Find lines referenced in the report for this file
    const referencedLines = new Set<number>();
    const relPath = filePath;
    for (const ref of report.filePaths) {
      if (relPath.endsWith(ref.path) && ref.line) {
        referencedLines.add(ref.line);
      }
    }
    if (report.stackTrace) {
      for (const frame of report.stackTrace) {
        if (relPath.endsWith(frame.filePath)) {
          referencedLines.add(frame.line);
        }
      }
    }

    // Sort blocks: those containing referenced lines first, then by line order
    blocks.sort((a, b) => {
      const aHasRef = this.blockContainsReferencedLine(a, referencedLines);
      const bHasRef = this.blockContainsReferencedLine(b, referencedLines);
      if (aHasRef && !bHasRef) return -1;
      if (!aHasRef && bHasRef) return 1;
      return a.startLine - b.startLine;
    });

    // Greedily add blocks within token budget
    const selectedBlocks: string[] = [];
    let usedTokens = 0;

    for (const block of blocks) {
      const blockTokens = this.estimateTokens(block.content);
      if (usedTokens + blockTokens <= maxTokens) {
        selectedBlocks.push(`// --- ${block.name} (line ${block.startLine}) ---\n${block.content}`);
        usedTokens += blockTokens;
      }
    }

    if (selectedBlocks.length === 0) {
      return this.truncateByLines(content, maxTokens);
    }

    return selectedBlocks.join('\n\n');
  }

  /** Check if a block contains any referenced line */
  private blockContainsReferencedLine(
    block: { startLine: number; content: string },
    referencedLines: Set<number>,
  ): boolean {
    const lineCount = block.content.split('\n').length;
    for (let line = block.startLine; line < block.startLine + lineCount; line++) {
      if (referencedLines.has(line)) return true;
    }
    return false;
  }

  /** Extract a code block starting at a given line (heuristic: brace matching) */
  private extractBlock(lines: string[], startLine: number): string | null {
    // startLine is 1-indexed
    const idx = startLine - 1;
    if (idx < 0 || idx >= lines.length) return null;

    let braceCount = 0;
    let started = false;
    const blockLines: string[] = [];

    for (let i = idx; i < lines.length; i++) {
      const line = lines[i];
      blockLines.push(line);

      for (const ch of line) {
        if (ch === '{') {
          braceCount++;
          started = true;
        } else if (ch === '}') {
          braceCount--;
        }
      }

      if (started && braceCount <= 0) {
        break;
      }

      // Safety: don't extract more than 200 lines for a single block
      if (blockLines.length > 200) break;
    }

    return blockLines.join('\n');
  }

  /** Simple line-based truncation fallback */
  private truncateByLines(content: string, maxTokens: number): string | null {
    const lines = content.split('\n');
    const result: string[] = [];
    let tokens = 0;

    for (const line of lines) {
      const lineTokens = this.estimateTokens(line + '\n');
      if (tokens + lineTokens > maxTokens) break;
      result.push(line);
      tokens += lineTokens;
    }

    return result.length > 0 ? result.join('\n') : null;
  }

  /** Detect project info by reading config files */
  private async detectProjectInfo(repoPath: string): Promise<ProjectInfo> {
    const defaultInfo: ProjectInfo = {
      name: path.basename(repoPath),
      language: 'typescript',
      dependencies: {},
      configFiles: [],
    };

    for (const configDef of PROJECT_CONFIG_FILES) {
      const configPath = path.join(repoPath, configDef.filename);
      try {
        if (await this.fileReader.exists(configPath)) {
          defaultInfo.configFiles.push(configDef.filename);
          defaultInfo.language = configDef.language;
          if (configDef.packageManager) {
            defaultInfo.packageManager = configDef.packageManager;
          }

          // Try to extract name and dependencies from package.json
          if (configDef.filename === 'package.json') {
            const content = await this.fileReader.readFile(configPath);
            try {
              const pkg = JSON.parse(content);
              if (pkg.name) defaultInfo.name = pkg.name;
              if (pkg.dependencies) {
                Object.assign(defaultInfo.dependencies, pkg.dependencies);
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      } catch {
        // Skip unreadable config files
      }
    }

    return defaultInfo;
  }
}
