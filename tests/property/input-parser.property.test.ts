import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { InputParser } from '../../src/input/parser.js';

/**
 * Property P1: 输入解析完整性
 * ∀ input ∈ String, 包含 N 个 `filepath:line` 模式:
 *   parse(input).filePaths.length >= N
 *
 * **Validates: Requirements 1.1**
 */

const parser = new InputParser();

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid path segment (1-8 alphanumeric/dash/underscore chars) */
const segmentArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(''),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((chars) => chars.join(''));

/** Generate a file extension */
const extensionArb = fc.constantFrom('ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'cpp', 'json');

/** Generate a relative file path with extension (e.g., src/utils/helper.ts) */
const filePathArb = fc
  .tuple(
    fc.constantFrom('', './', '../'),
    fc.array(segmentArb, { minLength: 0, maxLength: 3 }),
    segmentArb,
    extensionArb,
  )
  .map(([prefix, dirs, name, ext]) => {
    const dirPart = dirs.length > 0 ? dirs.join('/') + '/' : '';
    return `${prefix}${dirPart}${name}.${ext}`;
  });

/** Generate a positive line number */
const lineNumberArb = fc.integer({ min: 1, max: 99999 });

/** Generate a file:line pattern */
const fileLinePatternArb = fc
  .tuple(filePathArb, lineNumberArb)
  .map(([path, line]) => ({ path, line, pattern: `${path}:${line}` }));

/** Generate filler text that does NOT look like a file:line pattern */
const fillerArb = fc.constantFrom(
  'Error occurred while processing',
  'something went wrong',
  'check the logs for details',
  'unexpected behavior in module',
  'the function returned null',
  '',
);

describe('InputParser Property Tests', () => {
  it('P1: parse() extracts all filepath:line patterns from input', () => {
    fc.assert(
      fc.property(
        fc.array(fileLinePatternArb, { minLength: 1, maxLength: 5 }),
        fillerArb,
        (patterns, filler) => {
          // Build input string with patterns separated by filler/whitespace
          const parts: string[] = [];
          for (const p of patterns) {
            if (filler) parts.push(filler);
            parts.push(p.pattern);
          }
          const input = parts.join('\n');

          const result = parser.parse(input, 'cli-arg');
          expect(result.success).toBe(true);

          const extractedPaths = result.data!.filePaths;

          // For each embedded pattern, verify it was extracted
          for (const p of patterns) {
            const found = extractedPaths.some(
              (ref) => ref.path === p.path && ref.line === p.line,
            );
            expect(found).toBe(true);
          }

          // The total extracted count must be >= the number of distinct patterns
          const uniquePatterns = new Map<string, number>();
          for (const p of patterns) {
            uniquePatterns.set(`${p.path}:${p.line}`, p.line);
          }
          expect(extractedPaths.length).toBeGreaterThanOrEqual(uniquePatterns.size);
        },
      ),
      { numRuns: 200 },
    );
  });
});
