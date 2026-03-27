import type { BugReport } from '../types.js';

/** Metadata about a candidate file's relationship to the bug */
export interface FileMetadata {
  mentionedInReport: boolean;
  importDepth: number;
  recentCommitCount: number;
  hasErrorTrace: boolean;
}

/** A candidate file to be scored for relevance */
export interface CandidateFile {
  path: string;
  content: string;
  tokenCount: number;
  metadata: FileMetadata;
}

/** Weights for each scoring factor */
export interface ScoringWeights {
  mentionedInReport: number;
  importDepth: number;
  hasErrorTrace: number;
  recentCommitCount: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  mentionedInReport: 0.4,
  importDepth: 0.3,
  hasErrorTrace: 0.2,
  recentCommitCount: 0.1,
};

/**
 * Scores candidate files by relevance to a bug report.
 *
 * Formula:
 *   score = w1 * mentionedInReport
 *         + w2 * (1 / (importDepth + 1))
 *         + w3 * hasErrorTrace
 *         + w4 * normalize(recentCommitCount)
 *
 * The score is always clamped to [0, 1].
 */
export class RelevanceScorer {
  private weights: ScoringWeights;

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Compute the relevance score for a candidate file against a bug report.
   * Returns a value in [0, 1].
   */
  score(file: CandidateFile, _report: BugReport): number {
    const { metadata } = file;

    const mentionedScore = metadata.mentionedInReport ? 1 : 0;
    const depthScore = 1 / (metadata.importDepth + 1);
    const errorTraceScore = metadata.hasErrorTrace ? 1 : 0;
    const commitScore = this.normalizeCommitCount(metadata.recentCommitCount);

    const raw =
      this.weights.mentionedInReport * mentionedScore +
      this.weights.importDepth * depthScore +
      this.weights.hasErrorTrace * errorTraceScore +
      this.weights.recentCommitCount * commitScore;

    return Math.max(0, Math.min(1, raw));
  }

  /**
   * Normalize a commit count to [0, 1] using a sigmoid-like function.
   * Uses the formula: count / (count + k) where k controls the midpoint.
   * With k=5, a file with 5 recent commits scores 0.5.
   */
  private normalizeCommitCount(count: number, k = 5): number {
    if (count <= 0) return 0;
    return count / (count + k);
  }
}
