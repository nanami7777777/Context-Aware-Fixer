import { describe, it, expect } from 'vitest';
import { RelevanceScorer } from './relevance-scorer.js';
import type { CandidateFile, FileMetadata } from './relevance-scorer.js';
import type { BugReport } from '../types.js';

/** Helper to build a CandidateFile with given metadata overrides */
function makeFile(meta: Partial<FileMetadata> = {}): CandidateFile {
  return {
    path: '/repo/src/test.ts',
    content: 'const x = 1;',
    tokenCount: 10,
    metadata: {
      mentionedInReport: false,
      importDepth: 0,
      recentCommitCount: 0,
      hasErrorTrace: false,
      ...meta,
    },
  };
}

/** Minimal BugReport for scoring tests */
const report: BugReport = {
  rawInput: 'TypeError: cannot read property',
  source: 'cli-arg',
  errorType: 'TypeError',
  errorMessage: 'cannot read property',
  filePaths: [],
  keywords: [],
};

describe('RelevanceScorer', () => {
  const scorer = new RelevanceScorer();

  describe('score', () => {
    it('returns maximum score for a file that is mentioned, depth 0, in error trace, with commits', () => {
      const file = makeFile({
        mentionedInReport: true,
        importDepth: 0,
        hasErrorTrace: true,
        recentCommitCount: 100,
      });
      const s = scorer.score(file, report);
      // w1*1 + w2*(1/1) + w3*1 + w4*normalize(100)
      // 0.4 + 0.3 + 0.2 + 0.1*(100/105) ≈ 0.995
      expect(s).toBeGreaterThan(0.99);
      expect(s).toBeLessThanOrEqual(1);
    });

    it('returns minimum score for a file with no relevance signals', () => {
      const file = makeFile({
        mentionedInReport: false,
        importDepth: 999,
        hasErrorTrace: false,
        recentCommitCount: 0,
      });
      const s = scorer.score(file, report);
      // w1*0 + w2*(1/1000) + w3*0 + w4*0 ≈ 0.0003
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(0.01);
    });

    it('gives higher score when mentionedInReport is true', () => {
      const mentioned = makeFile({ mentionedInReport: true, importDepth: 5 });
      const notMentioned = makeFile({ mentionedInReport: false, importDepth: 5 });
      expect(scorer.score(mentioned, report)).toBeGreaterThan(scorer.score(notMentioned, report));
    });

    it('gives higher score for smaller importDepth', () => {
      const close = makeFile({ importDepth: 1 });
      const far = makeFile({ importDepth: 10 });
      expect(scorer.score(close, report)).toBeGreaterThan(scorer.score(far, report));
    });

    it('gives higher score when hasErrorTrace is true', () => {
      const traced = makeFile({ hasErrorTrace: true, importDepth: 5 });
      const notTraced = makeFile({ hasErrorTrace: false, importDepth: 5 });
      expect(scorer.score(traced, report)).toBeGreaterThan(scorer.score(notTraced, report));
    });

    it('gives higher score for more recent commits', () => {
      const active = makeFile({ recentCommitCount: 20, importDepth: 5 });
      const stale = makeFile({ recentCommitCount: 0, importDepth: 5 });
      expect(scorer.score(active, report)).toBeGreaterThan(scorer.score(stale, report));
    });

    it('score is always in [0, 1] range', () => {
      const extremes: CandidateFile[] = [
        makeFile({ mentionedInReport: true, importDepth: 0, hasErrorTrace: true, recentCommitCount: 10000 }),
        makeFile({ mentionedInReport: false, importDepth: 10000, hasErrorTrace: false, recentCommitCount: 0 }),
        makeFile({ mentionedInReport: true, importDepth: 0, hasErrorTrace: false, recentCommitCount: 0 }),
        makeFile({ mentionedInReport: false, importDepth: 0, hasErrorTrace: false, recentCommitCount: 0 }),
      ];
      for (const file of extremes) {
        const s = scorer.score(file, report);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    });

    it('importDepth 0 contributes full weight', () => {
      const depth0 = makeFile({ importDepth: 0 });
      // Only importDepth contributes (others are 0/false): w2 * (1/1) = 0.3
      const s = scorer.score(depth0, report);
      expect(s).toBeCloseTo(0.3, 5);
    });

    it('mentionedInReport alone contributes 0.4', () => {
      const file = makeFile({ mentionedInReport: true, importDepth: 999999 });
      const s = scorer.score(file, report);
      // 0.4 * 1 + 0.3 * ~0 + 0 + 0 ≈ 0.4
      expect(s).toBeCloseTo(0.4, 1);
    });
  });

  describe('custom weights', () => {
    it('allows overriding weights', () => {
      const customScorer = new RelevanceScorer({ mentionedInReport: 1.0, importDepth: 0, hasErrorTrace: 0, recentCommitCount: 0 });
      const mentioned = makeFile({ mentionedInReport: true, importDepth: 999 });
      const notMentioned = makeFile({ mentionedInReport: false, importDepth: 0 });
      expect(customScorer.score(mentioned, report)).toBe(1);
      expect(customScorer.score(notMentioned, report)).toBe(0);
    });
  });

  describe('normalizeCommitCount (via score)', () => {
    it('normalizes 0 commits to 0 contribution', () => {
      const file = makeFile({ recentCommitCount: 0, importDepth: 999999 });
      // Only commit weight matters, but count is 0 → 0
      const s = scorer.score(file, report);
      expect(s).toBeCloseTo(0, 1);
    });

    it('normalizes 5 commits to ~0.5 contribution (midpoint)', () => {
      // With only commit weight active: w4 * normalize(5) = 0.1 * 0.5 = 0.05
      const file = makeFile({ recentCommitCount: 5, importDepth: 999999 });
      const s = scorer.score(file, report);
      // importDepth ~0, so score ≈ 0.1 * 0.5 = 0.05
      expect(s).toBeCloseTo(0.05, 1);
    });

    it('normalizes large commit counts close to 1', () => {
      const file = makeFile({ recentCommitCount: 1000, importDepth: 999999 });
      const s = scorer.score(file, report);
      // 0.1 * (1000/1005) ≈ 0.0995
      expect(s).toBeCloseTo(0.1, 1);
    });
  });
});
