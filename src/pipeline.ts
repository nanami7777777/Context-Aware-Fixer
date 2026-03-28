// Pipeline — Orchestrates the full ContextFix workflow

import type { InputParser } from './input/parser.js';
import type { ContextCollector, ContextConfig } from './context/collector.js';
import type { RootCauseAnalyzer } from './analyzer/root-cause.js';
import type { PatchGenerator } from './patch/generator.js';
import type { OutputFormatter } from './output/formatter.js';
import type { PatchApplier } from './patch/applier.js';
import type { InputSource, RootCauseReport } from './types.js';
import { runTests } from './test-runner.js';
import type { TestResult } from './test-runner.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Configuration passed to pipeline methods */
export interface PipelineConfig {
  contextLimit: number;
  repoPath: string;
  gitHistoryDepth: number;
  ignorePatterns: string[];
  apply: boolean;
  dryRun: boolean;
  testCommand?: string | null;
}

/** Dependencies injected into the Pipeline */
export interface PipelineDeps {
  inputParser: InputParser;
  contextCollector: ContextCollector;
  rootCauseAnalyzer: RootCauseAnalyzer;
  patchGenerator: PatchGenerator;
  outputFormatter: OutputFormatter;
  patchApplier: PatchApplier;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Orchestrates the ContextFix pipeline stages:
 *   InputParser → ContextCollector → RootCauseAnalyzer → PatchGenerator → OutputFormatter
 *
 * Supports two modes:
 * - `fix`: Full pipeline (parse → collect → analyze → generate → format/apply)
 * - `analyze`: Analysis only (parse → collect → analyze → format)
 */
export class Pipeline {
  private readonly inputParser: InputParser;
  private readonly contextCollector: ContextCollector;
  private readonly rootCauseAnalyzer: RootCauseAnalyzer;
  private readonly patchGenerator: PatchGenerator;
  private readonly outputFormatter: OutputFormatter;
  private readonly patchApplier: PatchApplier;

  constructor(deps: PipelineDeps) {
    this.inputParser = deps.inputParser;
    this.contextCollector = deps.contextCollector;
    this.rootCauseAnalyzer = deps.rootCauseAnalyzer;
    this.patchGenerator = deps.patchGenerator;
    this.outputFormatter = deps.outputFormatter;
    this.patchApplier = deps.patchApplier;
  }

  /**
   * Run the full fix pipeline: parse → collect → analyze → generate → format/apply.
   * Returns the formatted output string.
   */
  async fix(input: string, source: InputSource, config: PipelineConfig): Promise<string> {
    // 1. Parse input
    const parseResult = this.inputParser.parse(input, source);
    if (!parseResult.success || !parseResult.data) {
      const errors = (parseResult.errors ?? []).map((e) => e.message).join('; ');
      throw new PipelineError('parse', `Failed to parse input: ${errors}`);
    }
    const report = parseResult.data;

    // 2. Collect context
    const contextConfig: ContextConfig = {
      maxTokens: config.contextLimit,
      repoPath: config.repoPath,
      gitHistoryDepth: config.gitHistoryDepth,
      ignorePatterns: config.ignorePatterns,
    };

    let context;
    try {
      context = await this.contextCollector.collect(report, contextConfig);
    } catch (err) {
      throw new PipelineError('collect', `Failed to collect context: ${errorMessage(err)}`);
    }

    // 3. Analyze root cause
    let rootCauseReport: RootCauseReport | undefined;
    try {
      for await (const chunk of this.rootCauseAnalyzer.analyze(context, report)) {
        if (chunk.type === 'complete') {
          rootCauseReport = chunk.data as RootCauseReport;
        }
      }
    } catch (err) {
      throw new PipelineError('analyze', `Failed to analyze root cause: ${errorMessage(err)}`);
    }

    if (!rootCauseReport) {
      throw new PipelineError('analyze', 'Root cause analysis produced no report');
    }

    // 4. Generate patches
    const output: string[] = [];
    output.push(this.outputFormatter.formatAnalysis(rootCauseReport));

    try {
      for await (const chunk of this.patchGenerator.generate(rootCauseReport, context)) {
        if (chunk.type === 'patch') {
          const patch = chunk.data as import('./types.js').Patch;
          output.push(this.outputFormatter.formatPatch(patch));

          // 5. Apply or preview if requested
          if (config.apply || config.dryRun) {
            const result = config.dryRun
              ? await this.patchApplier.preview(patch, config.repoPath)
              : await this.patchApplier.apply(patch, config.repoPath);
            output.push(this.outputFormatter.formatApplyResult(result));

            // 6. Run tests to verify the patch (only after real apply, not dry-run)
            if (config.apply && result.success && config.testCommand) {
              const testResult = await runTests(config.testCommand, config.repoPath);
              output.push(this.outputFormatter.formatTestResult(testResult));
            }
          }
        }
      }
    } catch (err) {
      throw new PipelineError('generate', `Failed to generate patches: ${errorMessage(err)}`);
    }

    return output.join('\n\n');
  }

  /**
   * Run the analysis-only pipeline: parse → collect → analyze → format.
   * Returns the formatted output string.
   */
  async analyze(input: string, source: InputSource, config: PipelineConfig): Promise<string> {
    // 1. Parse input
    const parseResult = this.inputParser.parse(input, source);
    if (!parseResult.success || !parseResult.data) {
      const errors = (parseResult.errors ?? []).map((e) => e.message).join('; ');
      throw new PipelineError('parse', `Failed to parse input: ${errors}`);
    }
    const report = parseResult.data;

    // 2. Collect context
    const contextConfig: ContextConfig = {
      maxTokens: config.contextLimit,
      repoPath: config.repoPath,
      gitHistoryDepth: config.gitHistoryDepth,
      ignorePatterns: config.ignorePatterns,
    };

    let context;
    try {
      context = await this.contextCollector.collect(report, contextConfig);
    } catch (err) {
      throw new PipelineError('collect', `Failed to collect context: ${errorMessage(err)}`);
    }

    // 3. Analyze root cause
    let rootCauseReport: RootCauseReport | undefined;
    try {
      for await (const chunk of this.rootCauseAnalyzer.analyze(context, report)) {
        if (chunk.type === 'complete') {
          rootCauseReport = chunk.data as RootCauseReport;
        }
      }
    } catch (err) {
      throw new PipelineError('analyze', `Failed to analyze root cause: ${errorMessage(err)}`);
    }

    if (!rootCauseReport) {
      throw new PipelineError('analyze', 'Root cause analysis produced no report');
    }

    // 4. Format output
    return this.outputFormatter.formatAnalysis(rootCauseReport);
  }
}

// ─── Pipeline Error ──────────────────────────────────────────────────────────

export type PipelineStage = 'parse' | 'collect' | 'analyze' | 'generate' | 'apply';

export class PipelineError extends Error {
  readonly stage: PipelineStage;

  constructor(stage: PipelineStage, message: string) {
    super(message);
    this.name = 'PipelineError';
    this.stage = stage;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
