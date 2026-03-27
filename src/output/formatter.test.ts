import { describe, it, expect, vi, afterEach } from 'vitest';
import type { RootCauseReport, Patch } from '../types.js';
import type { ApplyResult } from '../patch/applier.js';
import { PlainFormatter, createFormatter } from './formatter.js';
import { TerminalFormatter } from './terminal.js';

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
          content: '@@ -41,2 +41,4 @@\n-  const name = user.name;\n+  if (!user) throw new Error("user is null");\n+  const name = user.name;',
        },
      ],
    },
  ],
  pros: ['Simple fix', 'No breaking changes'],
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

// ─── PlainFormatter ──────────────────────────────────────────────────────────

describe('PlainFormatter', () => {
  const fmt = new PlainFormatter();

  describe('formatAnalysis', () => {
    it('includes summary', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('Summary: Null pointer in user service');
    });

    it('includes candidate details', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('#1 [confidence: 92%]');
      expect(out).toContain('Location: src/user.ts:42');
      expect(out).toContain('Missing null check on user object');
    });

    it('includes evidence when present', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('[code-snippet]');
      expect(out).toContain('src/user.ts:42');
    });

    it('handles candidate without line number', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toContain('Location: src/auth.ts');
      // Should NOT have a trailing colon with no line
      expect(out).not.toContain('Location: src/auth.ts:');
    });

    it('handles empty candidates', () => {
      const out = fmt.formatAnalysis({ summary: 'No issues', candidates: [] });
      expect(out).toContain('Summary: No issues');
      expect(out).toContain('Root Cause Analysis');
    });
  });

  describe('formatPatch', () => {
    it('includes patch id and description', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toContain('Patch: patch-001');
      expect(out).toContain('Description: Add null check for user object');
    });

    it('includes pros and cons', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toContain('+ Simple fix');
      expect(out).toContain('- Does not address root auth issue');
    });

    it('includes file change details', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(out).toContain('--- src/user.ts');
      expect(out).toContain('+++ src/user.ts');
      expect(out).toContain('Explanation: Guard against null user');
    });

    it('handles patch without pros/cons', () => {
      const minimal: Patch = {
        id: 'p2',
        description: 'Minimal',
        changes: [],
      };
      const out = fmt.formatPatch(minimal);
      expect(out).toContain('Patch: p2');
      expect(out).not.toContain('Pros:');
      expect(out).not.toContain('Cons:');
    });
  });

  describe('formatApplyResult', () => {
    it('formats successful result', () => {
      const out = fmt.formatApplyResult(successResult);
      expect(out).toContain('Patch applied successfully.');
      expect(out).toContain('src/user.ts');
      expect(out).toContain('Lines added: 2');
      expect(out).toContain('Lines deleted: 1');
    });

    it('formats failed result with conflicts', () => {
      const out = fmt.formatApplyResult(failResult);
      expect(out).toContain('Patch application failed.');
      expect(out).toContain('Context mismatch at line 41');
      expect(out).toContain('Re-run analysis');
    });
  });
});

// ─── createFormatter ─────────────────────────────────────────────────────────

describe('createFormatter', () => {
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    // Restore original value
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it('returns a formatter for plain mode', () => {
    const f = createFormatter('plain');
    expect(f).toBeInstanceOf(PlainFormatter);
  });

  it('returns a TerminalFormatter for terminal mode when TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      writable: true,
      configurable: true,
    });
    const f = createFormatter('terminal');
    expect(f).toBeInstanceOf(TerminalFormatter);
  });

  it('falls back to plain when terminal mode but not TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
    const f = createFormatter('terminal');
    expect(f).toBeInstanceOf(PlainFormatter);
  });

  it('returns a formatter for json mode', () => {
    const f = createFormatter('json');
    expect(f).toBeDefined();
    expect(typeof f.formatPatch).toBe('function');
  });

  it('plain output contains no ANSI escape sequences', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
    const f = createFormatter('terminal');
    const out = f.formatAnalysis(sampleReport);
    // ANSI escape codes start with \x1b[ or \u001b[
    expect(out).not.toMatch(/\x1b\[/);
  });
});
