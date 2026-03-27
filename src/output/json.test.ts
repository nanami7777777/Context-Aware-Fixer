import { describe, it, expect } from 'vitest';
import type { RootCauseReport, Patch } from '../types.js';
import type { ApplyResult } from '../patch/applier.js';
import { JsonFormatter } from './json.js';
import { createFormatter } from './formatter.js';

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

// ─── JsonFormatter ───────────────────────────────────────────────────────────

describe('JsonFormatter', () => {
  const fmt = new JsonFormatter();

  describe('formatAnalysis', () => {
    it('returns valid JSON', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('contains the report data', () => {
      const parsed = JSON.parse(fmt.formatAnalysis(sampleReport));
      expect(parsed.summary).toBe('Null pointer in user service');
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].confidence).toBe(0.92);
      expect(parsed.candidates[0].location.path).toBe('src/user.ts');
    });

    it('is pretty-printed with 2-space indent', () => {
      const out = fmt.formatAnalysis(sampleReport);
      expect(out).toBe(JSON.stringify(sampleReport, null, 2));
    });

    it('handles empty candidates', () => {
      const empty: RootCauseReport = { summary: 'No issues', candidates: [] };
      const parsed = JSON.parse(fmt.formatAnalysis(empty));
      expect(parsed.summary).toBe('No issues');
      expect(parsed.candidates).toEqual([]);
    });
  });

  describe('formatPatch', () => {
    it('returns valid JSON', () => {
      const out = fmt.formatPatch(samplePatch);
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('contains the patch data', () => {
      const parsed = JSON.parse(fmt.formatPatch(samplePatch));
      expect(parsed.id).toBe('patch-001');
      expect(parsed.description).toBe('Add null check for user object');
      expect(parsed.changes).toHaveLength(1);
      expect(parsed.pros).toContain('Simple fix');
      expect(parsed.cons).toContain('Does not address root auth issue');
    });

    it('handles patch without pros/cons', () => {
      const minimal: Patch = { id: 'p2', description: 'Minimal', changes: [] };
      const parsed = JSON.parse(fmt.formatPatch(minimal));
      expect(parsed.id).toBe('p2');
      expect(parsed.pros).toBeUndefined();
      expect(parsed.cons).toBeUndefined();
    });
  });

  describe('formatApplyResult', () => {
    it('returns valid JSON for success', () => {
      const out = fmt.formatApplyResult(successResult);
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('contains success result data', () => {
      const parsed = JSON.parse(fmt.formatApplyResult(successResult));
      expect(parsed.success).toBe(true);
      expect(parsed.filesModified).toEqual(['src/user.ts']);
      expect(parsed.linesAdded).toBe(2);
      expect(parsed.linesDeleted).toBe(1);
    });

    it('returns valid JSON for failure with conflicts', () => {
      const out = fmt.formatApplyResult(failResult);
      const parsed = JSON.parse(out);
      expect(parsed.success).toBe(false);
      expect(parsed.conflicts).toHaveLength(1);
      expect(parsed.conflicts[0].filePath).toBe('src/user.ts');
    });
  });
});

// ─── createFormatter integration ─────────────────────────────────────────────

describe('createFormatter with json mode', () => {
  it('returns a JsonFormatter instance', () => {
    const f = createFormatter('json');
    expect(f).toBeInstanceOf(JsonFormatter);
  });

  it('json output contains no ANSI escape sequences', () => {
    const f = createFormatter('json');
    const out = f.formatAnalysis(sampleReport);
    expect(out).not.toMatch(/\x1b\[/);
  });
});
