import { describe, it, expect } from 'vitest';
import { InputValidator } from './validators.js';
import type { BugReport } from '../types.js';

const validator = new InputValidator();

/** Helper to build a minimal BugReport with overrides. */
function makeBugReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    rawInput: 'some input',
    source: 'cli-arg',
    filePaths: [],
    keywords: [],
    ...overrides,
  };
}

describe('InputValidator.validate', () => {
  // ── Errors ─────────────────────────────────────────────────────────────

  it('returns error when no file paths and no stack trace', () => {
    const report = makeBugReport();
    const result = validator.validate(report);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('filePaths');
    expect(result.errors[0].suggestion).toBeDefined();
  });

  it('is valid when file paths are present', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts', line: 10 }],
      errorType: 'TypeError',
      errorMessage: 'Cannot read properties of undefined',
      stackTrace: [{ filePath: 'src/app.ts', line: 10, functionName: 'run' }],
    });
    const result = validator.validate(report);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('is valid when stack trace is present but no explicit file paths', () => {
    const report = makeBugReport({
      stackTrace: [{ filePath: '/project/src/main.ts', line: 1 }],
    });
    const result = validator.validate(report);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── Warnings ───────────────────────────────────────────────────────────

  it('warns when error type is missing', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts' }],
      errorMessage: 'something broke',
    });
    const result = validator.validate(report);

    expect(result.warnings.some((w) => w.includes('error type'))).toBe(true);
  });

  it('warns when error message is missing', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts' }],
      errorType: 'TypeError',
    });
    const result = validator.validate(report);

    expect(result.warnings.some((w) => w.includes('error message'))).toBe(true);
  });

  it('warns when stack trace is missing', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts' }],
    });
    const result = validator.validate(report);

    expect(result.warnings.some((w) => w.includes('stack trace'))).toBe(true);
  });

  it('warns when no description and no keywords', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts' }],
    });
    const result = validator.validate(report);

    expect(result.warnings.some((w) => w.includes('description'))).toBe(true);
  });

  it('warns about missing keywords when description exists but no keywords', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts' }],
      description: 'The app crashes on submit',
      keywords: [],
    });
    const result = validator.validate(report);

    expect(result.warnings.some((w) => w.includes('keywords'))).toBe(true);
  });

  it('does not warn about keywords when keywords are present', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts' }],
      description: 'The app crashes on submit',
      keywords: ['handleSubmit'],
    });
    const result = validator.validate(report);

    expect(result.warnings.every((w) => !w.includes('identifiable keywords'))).toBe(true);
  });

  // ── Full report (no warnings, no errors) ───────────────────────────────

  it('returns no warnings for a complete report', () => {
    const report = makeBugReport({
      filePaths: [{ path: 'src/app.ts', line: 10 }],
      errorType: 'TypeError',
      errorMessage: 'Cannot read properties of undefined',
      stackTrace: [{ filePath: 'src/app.ts', line: 10, functionName: 'run' }],
      description: 'App crashes on startup',
      keywords: ['run', 'app.ts'],
    });
    const result = validator.validate(report);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
