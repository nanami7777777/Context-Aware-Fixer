import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RelevanceScorer } from '../../src/context/relevance-scorer.js';
import type { CandidateFile, FileMetadata } from '../../src/context/relevance-scorer.js';
import type { BugReport } from '../../src/types.js';

/**
 * Property P4: 相关性评分有界性
 * ∀ file ∈ CandidateFile, report ∈ BugReport:
 *   0 <= score(file, report) <= 1
 *
 * **Validates: Requirements 2.5**
 */

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate arbitrary FileMetadata */
const fileMetadataArb: fc.Arbitrary<FileMetadata> = fc.record({
  mentionedInReport: fc.boolean(),
  importDepth: fc.nat({ max: 10000 }),
  recentCommitCount: fc.nat({ max: 100000 }),
  hasErrorTrace: fc.boolean(),
});

/** Generate arbitrary CandidateFile with random metadata */
const candidateFileArb: fc.Arbitrary<CandidateFile> = fc.record({
  path: fc.stringMatching(/^[a-zA-Z0-9_/.-]{1,100}$/),
  content: fc.string({ minLength: 0, maxLength: 200 }),
  tokenCount: fc.nat({ max: 100000 }),
  metadata: fileMetadataArb,
});

/** Minimal BugReport for scoring — the scorer does not inspect report fields */
const bugReportArb: fc.Arbitrary<BugReport> = fc.constant({
  rawInput: 'error occurred',
  source: 'cli-arg' as const,
  filePaths: [],
  keywords: [],
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('RelevanceScorer Property Tests', () => {
  const scorer = new RelevanceScorer();

  it('P4: score is always in [0, 1] for arbitrary candidate files', () => {
    fc.assert(
      fc.property(candidateFileArb, bugReportArb, (file, report) => {
        const score = scorer.score(file, report);

        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });

  /**
   * Property P6: 直接提及文件优先
   * ∀ mentioned ∈ {f | f.mentionedInReport == true},
   *   unmentioned ∈ {f | f.mentionedInReport == false}:
   *   score(mentioned, report) > score(unmentioned, report)
   *   (当其他条件相同时)
   *
   * **Validates: Requirements 2.5**
   */
  it('P6: mentioned file always scores higher than unmentioned file (all else equal)', () => {
    /** Generate shared metadata fields (excluding mentionedInReport) */
    const sharedMetadataArb = fc.record({
      importDepth: fc.nat({ max: 10000 }),
      recentCommitCount: fc.nat({ max: 100000 }),
      hasErrorTrace: fc.boolean(),
    });

    fc.assert(
      fc.property(sharedMetadataArb, bugReportArb, (shared, report) => {
        const basePath = 'src/example.ts';
        const baseContent = 'const x = 1;';
        const baseTokenCount = 10;

        const mentionedFile: CandidateFile = {
          path: basePath,
          content: baseContent,
          tokenCount: baseTokenCount,
          metadata: { ...shared, mentionedInReport: true },
        };

        const unmentionedFile: CandidateFile = {
          path: basePath,
          content: baseContent,
          tokenCount: baseTokenCount,
          metadata: { ...shared, mentionedInReport: false },
        };

        const mentionedScore = scorer.score(mentionedFile, report);
        const unmentionedScore = scorer.score(unmentionedFile, report);

        expect(mentionedScore).toBeGreaterThan(unmentionedScore);
      }),
      { numRuns: 500 },
    );
  });
});
