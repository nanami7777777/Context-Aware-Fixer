import type { BugReport, ValidationResult, ValidationError } from '../types.js';

/**
 * Standalone input validator for BugReport objects.
 *
 * Performs comprehensive checks beyond the basic validation in InputParser,
 * generating actionable suggestions when key information is missing.
 */
export class InputValidator {
  /**
   * Validate whether a BugReport contains enough information for meaningful
   * root-cause analysis and patch generation.
   */
  validate(report: BugReport): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    this.checkFilePaths(report, errors);
    this.checkErrorInfo(report, errors, warnings);
    this.checkStackTrace(report, warnings);
    this.checkDescription(report, warnings);
    this.checkKeywords(report, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ── Private checks ───────────────────────────────────────────────────────

  /**
   * File paths are critical — without them ContextFix cannot locate relevant code.
   */
  private checkFilePaths(report: BugReport, errors: ValidationError[]): void {
    const hasFilePaths = report.filePaths.length > 0;
    const hasStackTrace = (report.stackTrace?.length ?? 0) > 0;

    if (!hasFilePaths && !hasStackTrace) {
      errors.push({
        field: 'filePaths',
        message: 'No file paths or stack trace found in the bug report.',
        suggestion:
          'Include at least one file path (e.g., src/app.ts:42) or paste the full stack trace so ContextFix can locate the relevant code.',
      });
    }
  }

  /**
   * Error type helps narrow the category of bug (type error, reference error, etc.).
   */
  private checkErrorInfo(
    report: BugReport,
    errors: ValidationError[],
    warnings: string[],
  ): void {
    if (!report.errorType) {
      warnings.push(
        'No error type detected (e.g., TypeError, ReferenceError). Including the exact error type improves root-cause accuracy.',
      );
    }

    if (!report.errorMessage) {
      warnings.push(
        'No error message detected. Paste the full error output so ContextFix can better understand the failure.',
      );
    }
  }

  /**
   * A stack trace dramatically improves analysis quality.
   */
  private checkStackTrace(report: BugReport, warnings: string[]): void {
    if (!report.stackTrace || report.stackTrace.length === 0) {
      warnings.push(
        'No stack trace found. If available, include the complete stack trace for more precise root-cause analysis.',
      );
    }
  }

  /**
   * A natural-language description provides context that structured fields may miss.
   */
  private checkDescription(report: BugReport, warnings: string[]): void {
    if (!report.description && report.keywords.length === 0) {
      warnings.push(
        'No description or keywords extracted. Adding a brief description of the bug helps improve analysis quality.',
      );
    }
  }

  /**
   * Keywords help with relevance scoring during context collection.
   */
  private checkKeywords(report: BugReport, warnings: string[]): void {
    if (report.keywords.length === 0 && report.description) {
      warnings.push(
        'No identifiable keywords (function names, class names) found. Mentioning specific identifiers can help locate the relevant code faster.',
      );
    }
  }
}
