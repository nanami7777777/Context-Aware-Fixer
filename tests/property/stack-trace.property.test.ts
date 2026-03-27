import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { InputParser } from '../../src/input/parser.js';

/**
 * Property P7: 堆栈追踪解析顺序保持
 * ∀ input 包含 stacktrace with frames [f1, f2, ..., fn]:
 *   parse(input).stackTrace == [f1, f2, ..., fn] (顺序一致)
 *
 * **Validates: Requirements 1.2**
 */

const parser = new InputParser();

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid identifier for function names (camelCase-ish) */
const functionNameArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
      ),
      { minLength: 1, maxLength: 12 },
    ),
  )
  .map(([first, rest]) => first + rest.join(''));

/** Generate a path segment */
const segmentArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split(''),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((chars) => chars.join(''));

/** Generate a file extension */
const extensionArb = fc.constantFrom('ts', 'js', 'tsx', 'jsx', 'py', 'java', 'go');

/** Generate a file path for stack frames (e.g., src/utils/helper.ts) */
const filePathArb = fc
  .tuple(
    fc.array(segmentArb, { minLength: 0, maxLength: 3 }),
    segmentArb,
    extensionArb,
  )
  .map(([dirs, name, ext]) => {
    const dirPart = dirs.length > 0 ? dirs.join('/') + '/' : '';
    return `${dirPart}${name}.${ext}`;
  });

/** Generate a positive line number */
const lineArb = fc.integer({ min: 1, max: 99999 });

/** Generate a positive column number */
const colArb = fc.integer({ min: 1, max: 999 });

/** Generate a single stack frame with its expected data and string representation */
const stackFrameArb = fc
  .tuple(functionNameArb, filePathArb, lineArb, colArb)
  .map(([funcName, filePath, line, col]) => ({
    expected: { functionName: funcName, filePath, line, column: col },
    text: `    at ${funcName} (${filePath}:${line}:${col})`,
  }));

/** Generate an error message line */
const errorMessageArb = fc
  .tuple(
    fc.constantFrom('Error', 'TypeError', 'ReferenceError', 'RangeError'),
    fc.array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz '.split(''),
      ),
      { minLength: 3, maxLength: 20 },
    ),
  )
  .map(([type, msgChars]) => `${type}: ${msgChars.join('')}`);

describe('Stack Trace Property Tests', () => {
  it('P7: parsed StackFrame array preserves original call order', () => {
    fc.assert(
      fc.property(
        errorMessageArb,
        fc.array(stackFrameArb, { minLength: 1, maxLength: 10 }),
        (errorLine, frames) => {
          // Build a realistic stack trace string
          const lines = [errorLine, ...frames.map((f) => f.text)];
          const input = lines.join('\n');

          const result = parser.parse(input, 'cli-arg');
          expect(result.success).toBe(true);

          const stackTrace = result.data!.stackTrace;
          expect(stackTrace).toBeDefined();
          expect(stackTrace!.length).toBe(frames.length);

          // Verify order is preserved: frame i in output matches frame i in input
          for (let i = 0; i < frames.length; i++) {
            const parsed = stackTrace![i];
            const expected = frames[i].expected;

            expect(parsed.functionName).toBe(expected.functionName);
            expect(parsed.filePath).toBe(expected.filePath);
            expect(parsed.line).toBe(expected.line);
            expect(parsed.column).toBe(expected.column);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
