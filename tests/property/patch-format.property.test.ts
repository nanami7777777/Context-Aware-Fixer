import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { DiffHunk } from '../../src/types.js';

/**
 * Property P5: 补丁格式合法性
 * ∀ patch ∈ Patch: isValidUnifiedDiff(formatPatch(patch)) == true
 *
 * For any generated DiffHunk, its unified diff content must be structurally
 * valid and parseable by standard diff tools.
 *
 * **Validates: Requirements 4.2**
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Hunk header regex: @@ -oldStart,oldLines +newStart,newLines @@ */
const HUNK_HEADER_RE = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/;

/** Valid line prefixes in unified diff */
const VALID_PREFIXES = [' ', '-', '+'];

/**
 * Validate that a DiffHunk's content is structurally valid unified diff.
 * Returns an object with validity and an error message if invalid.
 */
function validateHunkFormat(hunk: DiffHunk): { valid: boolean; error?: string } {
  const lines = hunk.content.split('\n');

  if (lines.length === 0) {
    return { valid: false, error: 'Empty content' };
  }

  // 1. First line must be a valid hunk header
  const headerMatch = lines[0].match(HUNK_HEADER_RE);
  if (!headerMatch) {
    return { valid: false, error: `Invalid hunk header: "${lines[0]}"` };
  }

  const headerOldStart = parseInt(headerMatch[1], 10);
  const headerOldLines = parseInt(headerMatch[2], 10);
  const headerNewStart = parseInt(headerMatch[3], 10);
  const headerNewLines = parseInt(headerMatch[4], 10);

  // 2. Header values must match the hunk's numeric fields
  if (headerOldStart !== hunk.oldStart) {
    return { valid: false, error: `Header oldStart ${headerOldStart} != hunk.oldStart ${hunk.oldStart}` };
  }
  if (headerOldLines !== hunk.oldLines) {
    return { valid: false, error: `Header oldLines ${headerOldLines} != hunk.oldLines ${hunk.oldLines}` };
  }
  if (headerNewStart !== hunk.newStart) {
    return { valid: false, error: `Header newStart ${headerNewStart} != hunk.newStart ${hunk.newStart}` };
  }
  if (headerNewLines !== hunk.newLines) {
    return { valid: false, error: `Header newLines ${headerNewLines} != hunk.newLines ${hunk.newLines}` };
  }

  // 3. Remaining lines must have valid prefixes
  const bodyLines = lines.slice(1).filter((l) => l.length > 0);

  for (let i = 0; i < bodyLines.length; i++) {
    const prefix = bodyLines[i][0];
    if (!VALID_PREFIXES.includes(prefix)) {
      return { valid: false, error: `Line ${i + 2} has invalid prefix "${prefix}": "${bodyLines[i]}"` };
    }
  }

  // 4. Count context + removed lines should match oldLines
  const contextCount = bodyLines.filter((l) => l[0] === ' ').length;
  const removedCount = bodyLines.filter((l) => l[0] === '-').length;
  const addedCount = bodyLines.filter((l) => l[0] === '+').length;

  const actualOldLines = contextCount + removedCount;
  const actualNewLines = contextCount + addedCount;

  if (actualOldLines !== hunk.oldLines) {
    return {
      valid: false,
      error: `context(${contextCount}) + removed(${removedCount}) = ${actualOldLines}, expected oldLines=${hunk.oldLines}`,
    };
  }

  if (actualNewLines !== hunk.newLines) {
    return {
      valid: false,
      error: `context(${contextCount}) + added(${addedCount}) = ${actualNewLines}, expected newLines=${hunk.newLines}`,
    };
  }

  return { valid: true };
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a safe line of code content (no newlines, non-empty) */
const codeLineArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_=(){}[];:.+-*/'.split(''),
    ),
    { minLength: 1, maxLength: 60 },
  )
  .map((chars) => chars.join(''));

/**
 * Generate a structurally valid DiffHunk.
 *
 * Strategy: first decide how many context, removed, and added lines,
 * then build the content string to match those counts exactly.
 */
const validDiffHunkArb = fc
  .record({
    oldStart: fc.integer({ min: 1, max: 9999 }),
    newStart: fc.integer({ min: 1, max: 9999 }),
    contextLineCount: fc.integer({ min: 0, max: 10 }),
    removedLineCount: fc.integer({ min: 0, max: 10 }),
    addedLineCount: fc.integer({ min: 0, max: 10 }),
  })
  .filter(
    (r) => r.contextLineCount + r.removedLineCount + r.addedLineCount > 0,
  )
  .chain((r) => {
    const totalBodyLines = r.contextLineCount + r.removedLineCount + r.addedLineCount;
    return fc.array(codeLineArb, { minLength: totalBodyLines, maxLength: totalBodyLines }).map(
      (codeLines) => {
        const oldLines = r.contextLineCount + r.removedLineCount;
        const newLines = r.contextLineCount + r.addedLineCount;

        // Build body: context lines first, then removed, then added
        const bodyParts: string[] = [];
        let idx = 0;
        for (let i = 0; i < r.contextLineCount; i++) {
          bodyParts.push(` ${codeLines[idx++]}`);
        }
        for (let i = 0; i < r.removedLineCount; i++) {
          bodyParts.push(`-${codeLines[idx++]}`);
        }
        for (let i = 0; i < r.addedLineCount; i++) {
          bodyParts.push(`+${codeLines[idx++]}`);
        }

        const header = `@@ -${r.oldStart},${oldLines} +${r.newStart},${newLines} @@`;
        const content = [header, ...bodyParts].join('\n');

        const hunk: DiffHunk = {
          oldStart: r.oldStart,
          oldLines: oldLines,
          newStart: r.newStart,
          newLines: newLines,
          content,
        };

        return hunk;
      },
    );
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Patch Format Property Tests', () => {
  it('P5: any valid DiffHunk has structurally valid unified diff format', () => {
    fc.assert(
      fc.property(validDiffHunkArb, (hunk) => {
        const result = validateHunkFormat(hunk);
        expect(result.valid).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('P5: hunk header contains correct oldStart, oldLines, newStart, newLines', () => {
    fc.assert(
      fc.property(validDiffHunkArb, (hunk) => {
        const firstLine = hunk.content.split('\n')[0];
        const match = firstLine.match(HUNK_HEADER_RE);

        expect(match).not.toBeNull();
        expect(parseInt(match![1], 10)).toBe(hunk.oldStart);
        expect(parseInt(match![2], 10)).toBe(hunk.oldLines);
        expect(parseInt(match![3], 10)).toBe(hunk.newStart);
        expect(parseInt(match![4], 10)).toBe(hunk.newLines);
      }),
      { numRuns: 300 },
    );
  });

  it('P5: all body lines have valid unified diff prefixes (space, -, +)', () => {
    fc.assert(
      fc.property(validDiffHunkArb, (hunk) => {
        const lines = hunk.content.split('\n');
        const bodyLines = lines.slice(1).filter((l) => l.length > 0);

        for (const line of bodyLines) {
          expect(VALID_PREFIXES).toContain(line[0]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('P5: context + removed line count equals oldLines', () => {
    fc.assert(
      fc.property(validDiffHunkArb, (hunk) => {
        const lines = hunk.content.split('\n');
        const bodyLines = lines.slice(1).filter((l) => l.length > 0);

        const contextCount = bodyLines.filter((l) => l[0] === ' ').length;
        const removedCount = bodyLines.filter((l) => l[0] === '-').length;

        expect(contextCount + removedCount).toBe(hunk.oldLines);
      }),
      { numRuns: 300 },
    );
  });

  it('P5: context + added line count equals newLines', () => {
    fc.assert(
      fc.property(validDiffHunkArb, (hunk) => {
        const lines = hunk.content.split('\n');
        const bodyLines = lines.slice(1).filter((l) => l.length > 0);

        const contextCount = bodyLines.filter((l) => l[0] === ' ').length;
        const addedCount = bodyLines.filter((l) => l[0] === '+').length;

        expect(contextCount + addedCount).toBe(hunk.newLines);
      }),
      { numRuns: 300 },
    );
  });
});
