import { describe, it, expect, afterEach } from 'vitest';
import * as fc from 'fast-check';
import type {
  RootCauseReport,
  RootCauseCandidate,
  Evidence,
  FileReference,
  Patch,
  FileChange,
  DiffHunk,
} from '../../src/types.js';
import type { ApplyResult, ConflictInfo } from '../../src/patch/applier.js';
import { createFormatter } from '../../src/output/formatter.js';

/**
 * Property P10: 输出模式自动检测
 * WHEN process.stdout.isTTY == false:
 *   ∀ output ∈ formattedOutput:
 *     containsAnsiEscapes(output) == false
 *
 * **Validates: Requirements 10.5**
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ANSI escape sequence pattern */
const ANSI_ESCAPE_RE = /\x1b\[/;

function containsAnsiEscapes(str: string): boolean {
  return ANSI_ESCAPE_RE.test(str);
}

/** Generate a safe string from a character set */
function safeStringArb(minLen: number, maxLen: number, chars: string): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...chars.split('')), { minLength: minLen, maxLength: maxLen })
    .map((c) => c.join(''));
}

// ─── Generators ──────────────────────────────────────────────────────────────

const PATH_CHARS = 'abcdefghijklmnopqrstuvwxyz/._-';
const TEXT_CHARS = 'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_=(){}[];:.+-*/';

const fileReferenceArb: fc.Arbitrary<FileReference> = fc.record({
  path: safeStringArb(3, 40, PATH_CHARS),
  line: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: undefined }),
  column: fc.option(fc.integer({ min: 1, max: 200 }), { nil: undefined }),
});

const evidenceArb: fc.Arbitrary<Evidence> = fc.record({
  type: fc.constantFrom('code-snippet', 'git-history', 'dependency') as fc.Arbitrary<Evidence['type']>,
  content: safeStringArb(1, 100, TEXT_CHARS),
  source: safeStringArb(1, 50, TEXT_CHARS),
});

const rootCauseCandidateArb: fc.Arbitrary<RootCauseCandidate> = fc.record({
  rank: fc.integer({ min: 1, max: 10 }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  location: fileReferenceArb,
  description: safeStringArb(1, 200, TEXT_CHARS),
  impact: safeStringArb(1, 200, TEXT_CHARS),
  evidence: fc.array(evidenceArb, { minLength: 0, maxLength: 3 }),
});

const rootCauseReportArb: fc.Arbitrary<RootCauseReport> = fc.record({
  candidates: fc.array(rootCauseCandidateArb, { minLength: 1, maxLength: 5 }),
  summary: safeStringArb(1, 200, TEXT_CHARS),
});

const diffHunkArb: fc.Arbitrary<DiffHunk> = fc.record({
  oldStart: fc.integer({ min: 1, max: 999 }),
  oldLines: fc.integer({ min: 1, max: 20 }),
  newStart: fc.integer({ min: 1, max: 999 }),
  newLines: fc.integer({ min: 1, max: 20 }),
  content: safeStringArb(1, 200, TEXT_CHARS),
});

const fileChangeArb: fc.Arbitrary<FileChange> = fc.record({
  filePath: safeStringArb(3, 40, PATH_CHARS),
  hunks: fc.array(diffHunkArb, { minLength: 1, maxLength: 3 }),
  explanation: safeStringArb(1, 100, TEXT_CHARS),
});

const patchArb: fc.Arbitrary<Patch> = fc.record({
  id: safeStringArb(1, 20, 'abcdefghijklmnopqrstuvwxyz0123456789-'),
  description: safeStringArb(1, 200, TEXT_CHARS),
  changes: fc.array(fileChangeArb, { minLength: 1, maxLength: 3 }),
  pros: fc.option(
    fc.array(safeStringArb(1, 50, TEXT_CHARS), { minLength: 0, maxLength: 3 }),
    { nil: undefined },
  ),
  cons: fc.option(
    fc.array(safeStringArb(1, 50, TEXT_CHARS), { minLength: 0, maxLength: 3 }),
    { nil: undefined },
  ),
});

const conflictInfoArb: fc.Arbitrary<ConflictInfo> = fc.record({
  filePath: safeStringArb(3, 40, PATH_CHARS),
  reason: safeStringArb(1, 100, TEXT_CHARS),
  suggestion: safeStringArb(1, 100, TEXT_CHARS),
});

const applyResultArb: fc.Arbitrary<ApplyResult> = fc.oneof(
  // Success case
  fc.record({
    success: fc.constant(true) as fc.Arbitrary<true>,
    filesModified: fc.array(safeStringArb(3, 30, PATH_CHARS), { minLength: 1, maxLength: 5 }),
    linesAdded: fc.integer({ min: 0, max: 500 }),
    linesDeleted: fc.integer({ min: 0, max: 500 }),
    conflicts: fc.constant(undefined) as fc.Arbitrary<undefined>,
  }),
  // Failure case
  fc.record({
    success: fc.constant(false) as fc.Arbitrary<false>,
    filesModified: fc.constant([]) as fc.Arbitrary<string[]>,
    linesAdded: fc.constant(0),
    linesDeleted: fc.constant(0),
    conflicts: fc.array(conflictInfoArb, { minLength: 1, maxLength: 3 }),
  }),
);

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Output Mode Auto-Detection Property Tests', () => {
  const savedIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: savedIsTTY,
      writable: true,
      configurable: true,
    });
  });

  function setNonTTY(): void {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });
  }

  it('P10: formatAnalysis output contains no ANSI escapes when stdout is not TTY', () => {
    fc.assert(
      fc.property(rootCauseReportArb, (report) => {
        setNonTTY();
        const formatter = createFormatter('terminal');
        const output = formatter.formatAnalysis(report);
        expect(containsAnsiEscapes(output)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('P10: formatPatch output contains no ANSI escapes when stdout is not TTY', () => {
    fc.assert(
      fc.property(patchArb, (patch) => {
        setNonTTY();
        const formatter = createFormatter('terminal');
        const output = formatter.formatPatch(patch);
        expect(containsAnsiEscapes(output)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('P10: formatApplyResult output contains no ANSI escapes when stdout is not TTY', () => {
    fc.assert(
      fc.property(applyResultArb, (result) => {
        setNonTTY();
        const formatter = createFormatter('terminal');
        const output = formatter.formatApplyResult(result);
        expect(containsAnsiEscapes(output)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
