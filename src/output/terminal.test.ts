import { describe, it, expect } from 'vitest';
import type { RootCauseReport, Patch } from '../types.js';
import type { ApplyResult } from '../patch/applier.js';
import { TerminalFormatter } from './terminal.js';

// ─── ANSI detection helper ───────────────────────────────────────────────────

const ANSI_RE = /\x1b\[/;

// ─── Fixtures ────────────────────────────────────────────────────────────────

const sampleReport: RootCauseReport = {
  summary: 'Null pointer in user service',
  candidates: [
    {
      rank: 1,
      confidence: 0.92,
      location: { path: 'src/user.ts', line: 42 },
      description: 'Missing null check on user object',
      impact: 'Crashes on unauthenticated requests',
      evidence: [
        { type: 'code-snippet', content: 'user.name', source: 'src/user.ts:42' },
      ],
    },
    {
      rank: 2,
      confidence: 0.45,
      location: { path: 'src/auth.ts' },
      description: 'Auth middleware not applied',
      impact: 'Allows unauthenticated access',
      evidence: [],
    },
    {
      rank: 3,
      confidence: 0.2,
      location: { path: 'src/db.ts', line: 10 },
      description: 'Connection pool exhausted',
      impact: 'Intermittent failures',
      evidence: [],
    },
  ],
};

const samplePatch: Patch = {
  id: 'patch-001',
  description: 'Add null check for user object',
  changes: [
    {
      filePath: 'src/user.ts',
      explanation: 'Guard against null user',
      hunks: [
        {
          oldStart: 41,
          oldLines: 2,
          newStart: 41,
          newLines: 4,
          content:
            '@@ -41,2 +41,4 @@\n-  const name = user.name;\n+  if (!user) throw new Error("user is null");\n+  const name = user.name;',
        },
      ],
    },
  ],
  pros: ['Simple fix'],
  cons: ['Does not address root auth issue'],
};

const successResult: ApplyResult = {
  success: true,
  filesModified: ['src/user.ts'],
  linesAdded: 2,
  linesDeleted: 1,
};

const failResult: ApplyResult = {
  success: false,
  filesModified: [],
  linesAdded: 0,
  linesDeleted: 0,
  conflicts: [
    {
      filePath: 'src/user.ts',
      reason: 'Context mismatch at line 41',
      suggestion: 'Re-run analysis to generate an updated patch.',
    },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TerminalFormatter', () => {
  const fmt = new TerminalFormatter();

  describe('formatAnalysis', () => {
    it('produces output containing ANSI escape sequences', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toMatch(ANSI_RE);
    });

    it('includes summary text', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('Null pointer in user service');
    });

    it('includes candidate rank and confidence', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('#1');
      expect(out).toContain('92%');
    });

    it('color-codes high confidence in green', () => {
      const out = fmt.formatAnalysis(sampleReport);
      // High confidence (0.92) should use green ANSI code
      expect(out).toContain('\x1b[32m92%');
    });

    it('color-codes medium confidence in yellow', () => {
      const out = fmt.formatAnalysis(sampleReport);
      // Medium confidence (0.45) should use yellow ANSI code
      expect(out).toContain('\x1b[33m45%');
    });

    it('color-codes low confidence in red', () => {
      const out = fmt.formatAnalysis(sampleReport);
      // Low confidence (0.2) should use red ANSI code
      expect(out).toContain('\x1b[31m20%');
    });

    it('includes evidence details', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('code-snippet');
      expect(out).toContain('src/user.ts:42');
    });

    it('handles empty candidates', () => {
      const out = fmt.formatAnalysis({ summary: 'No issues', candidates: [] });
      expect(out).toContain('No issues');
      expect(out).toMatch(ANSI_RE);
    });
  });

  describe('formatPatch', () => {
    it('produces output containing ANSI escape sequences', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toMatch(ANSI_RE);
    });

    it('includes patch id and description', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toContain('patch-001');
      expect(out).toContain('Add null check for user object');
    });

    it('colors addition lines in green', () => {
      const out = fmt.formatPatch(samplePatch);
      // Lines starting with + should be wrapped in green ANSI
      expect(out).toContain('\x1b[32m+');
    });

    it('colors deletion lines in red', () => {
      const out = fmt.formatPatch(samplePatch);
      // Lines starting with - should be wrapped in red ANSI
      expect(out).toContain('\x1b[31m-');
    });

    it('colors hunk headers in cyan', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toContain('\x1b[36m@@');
    });

    it('includes pros in green and cons in red', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toContain('Simple fix');
      expect(out).toContain('Does not address root auth issue');
    });

    it('handles patch without pros/cons', () => {
      const minimal: Patch = { id: 'p2', description: 'Minimal', changes: [] };
      const out = fmt.formatPatch(minimal);
      expect(out).toContain('p2');
      expect(out).not.toContain('Pros:');
      expect(out).not.toContain('Cons:');
    });
  });

  describe('formatApplyResult', () => {
    it('formats success with ANSI escape sequences', () => {
      const out = fmt.formatApplyResult(successResult);
      expect(out).toMatch(ANSI_RE);
      expect(out).toContain('successfully');
      expect(out).toContain('src/user.ts');
    });

    it('formats failure with ANSI escape sequences', () => {
      const out = fmt.formatApplyResult(failResult);
      expect(out).toMatch(ANSI_RE);
      expect(out).toContain('failed');
      expect(out).toContain('Context mismatch');
    });

    it('shows added/deleted line counts', () => {
      const out = fmt.formatApplyResult(successResult);
      expect(out).toContain('+2');
      expect(out).toContain('-1');
    });
  });
});
