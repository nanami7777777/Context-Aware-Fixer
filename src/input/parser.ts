import type {
  BugReport,
  ParseResult,
  InputSource,
  FileReference,
  StackFrame,
  ValidationResult,
} from '../types.js';

// ─── Regex Patterns ──────────────────────────────────────────────────────────

/** Matches file paths with optional line and column numbers: /path/to/file.ts:42:10 */
const FILE_PATH_PATTERN =
  /(?:^|[\s'"(])([a-zA-Z]:\\[\w\\.-]+|(?:\.{0,2}\/)?[\w./-]+\.[\w]+)(?::(\d+))?(?::(\d+))?/gm;

/** Matches common JS/TS error type prefixes */
const ERROR_TYPE_PATTERN =
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error|AggregateError|InternalError)\b/;

/** Matches the error message line: "ErrorType: message text" */
const ERROR_MESSAGE_PATTERN =
  /\b(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error|AggregateError|InternalError):\s*(.+)/;

/** Matches a single stack trace frame: "at functionName (file:line:col)" or "at file:line:col" */
const STACK_FRAME_PATTERN =
  /^\s*at\s+(?:(.+?)\s+\((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))\s*$/;

/** Matches file-like tokens in natural language: word.ext */
const FILENAME_PATTERN = /\b([\w.-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|c|cpp|h|hpp|rb|php|vue|svelte|css|scss|html|json|yaml|yml|toml|md))\b/gi;

/** Matches function/method-like identifiers: camelCase, snake_case, PascalCase */
const FUNCTION_NAME_PATTERN = /\b([a-z_$][\w$]*(?:\.\w+)*)\s*\(/g;

/** Matches PascalCase class/component names */
const CLASS_NAME_PATTERN = /\b([A-Z][\w]*(?:\.[A-Z][\w]*)*)\b/g;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deduplicate file references by path+line */
function deduplicateFileRefs(refs: FileReference[]): FileReference[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.path}:${ref.line ?? ''}:${ref.column ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deduplicate strings (case-sensitive) */
function deduplicateStrings(items: string[]): string[] {
  return [...new Set(items)];
}

// ─── InputParser ─────────────────────────────────────────────────────────────

export class InputParser {
  /**
   * Parse raw text input into a structured BugReport.
   */
  parse(raw: string, source: InputSource): ParseResult<BugReport> {
    if (!raw || raw.trim().length === 0) {
      return {
        success: false,
        errors: [
          {
            field: 'rawInput',
            message: 'Input is empty',
            suggestion: 'Provide an error message, stack trace, or bug description.',
          },
        ],
      };
    }

    const errorType = this.extractErrorType(raw);
    const errorMessage = this.extractErrorMessage(raw);
    const stackTrace = this.extractStackTrace(raw);
    const filePaths = this.extractFilePaths(raw, stackTrace);
    const keywords = this.extractKeywords(raw);
    const description = this.extractDescription(raw);

    const report: BugReport = {
      rawInput: raw,
      source,
      errorType: errorType ?? undefined,
      errorMessage: errorMessage ?? undefined,
      filePaths,
      stackTrace: stackTrace.length > 0 ? stackTrace : undefined,
      keywords,
      description: description ?? undefined,
    };

    return { success: true, data: report };
  }

  /**
   * Validate whether a BugReport contains enough information for analysis.
   */
  validate(report: BugReport): ValidationResult {
    const errors: ValidationResult['errors'] = [];
    const warnings: string[] = [];

    if (report.filePaths.length === 0 && !report.stackTrace?.length) {
      errors.push({
        field: 'filePaths',
        message: 'No file paths found in the bug report.',
        suggestion:
          'Include a file path (e.g., src/app.ts:42) or a stack trace so ContextFix can locate the relevant code.',
      });
    }

    if (!report.errorType && !report.errorMessage) {
      warnings.push(
        'No error type or message detected. Consider including the exact error output for better analysis.',
      );
    }

    if (report.keywords.length === 0 && !report.description) {
      warnings.push(
        'No keywords or description extracted. A brief description of the bug helps improve root cause analysis.',
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ── Private extraction methods ───────────────────────────────────────────

  private extractErrorType(raw: string): string | null {
    const match = raw.match(ERROR_TYPE_PATTERN);
    return match ? match[1] : null;
  }

  private extractErrorMessage(raw: string): string | null {
    const match = raw.match(ERROR_MESSAGE_PATTERN);
    return match ? match[2].trim() : null;
  }

  private extractStackTrace(raw: string): StackFrame[] {
    const lines = raw.split('\n');
    const frames: StackFrame[] = [];

    for (const line of lines) {
      const match = line.match(STACK_FRAME_PATTERN);
      if (!match) continue;

      if (match[2]) {
        // "at functionName (file:line:col)"
        frames.push({
          functionName: match[1],
          filePath: match[2],
          line: parseInt(match[3], 10),
          column: parseInt(match[4], 10),
        });
      } else if (match[5]) {
        // "at file:line:col"
        frames.push({
          filePath: match[5],
          line: parseInt(match[6], 10),
          column: parseInt(match[7], 10),
        });
      }
    }

    return frames;
  }

  private extractFilePaths(
    raw: string,
    stackFrames: StackFrame[],
  ): FileReference[] {
    const refs: FileReference[] = [];

    // Extract from regex matches in the raw text
    let match: RegExpExecArray | null;
    const pattern = new RegExp(FILE_PATH_PATTERN.source, FILE_PATH_PATTERN.flags);
    while ((match = pattern.exec(raw)) !== null) {
      const filePath = match[1];
      const line = match[2] ? parseInt(match[2], 10) : undefined;
      const column = match[3] ? parseInt(match[3], 10) : undefined;
      refs.push({ path: filePath, line, column });
    }

    // Also include paths from parsed stack frames
    for (const frame of stackFrames) {
      refs.push({
        path: frame.filePath,
        line: frame.line,
        column: frame.column,
      });
    }

    return deduplicateFileRefs(refs);
  }

  private extractKeywords(raw: string): string[] {
    const keywords: string[] = [];

    // Extract file names mentioned in text
    let match: RegExpExecArray | null;

    const fnPattern = new RegExp(FILENAME_PATTERN.source, FILENAME_PATTERN.flags);
    while ((match = fnPattern.exec(raw)) !== null) {
      keywords.push(match[1]);
    }

    // Extract function/method names (identifiers followed by parentheses)
    const funcPattern = new RegExp(FUNCTION_NAME_PATTERN.source, FUNCTION_NAME_PATTERN.flags);
    while ((match = funcPattern.exec(raw)) !== null) {
      const name = match[1];
      // Filter out common noise words
      if (!isNoiseWord(name)) {
        keywords.push(name);
      }
    }

    // Extract PascalCase class/component names
    const classPattern = new RegExp(CLASS_NAME_PATTERN.source, CLASS_NAME_PATTERN.flags);
    while ((match = classPattern.exec(raw)) !== null) {
      const name = match[1];
      if (!isNoiseWord(name) && name.length > 1) {
        keywords.push(name);
      }
    }

    return deduplicateStrings(keywords);
  }

  private extractDescription(raw: string): string | null {
    // If the input looks like pure stack trace / error, no separate description
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const nonStackLines = lines.filter(
      (line) => !line.startsWith('at ') && !STACK_FRAME_PATTERN.test(line),
    );

    if (nonStackLines.length === 0) return null;

    // Use non-stack-trace lines as the description
    const desc = nonStackLines.join('\n').trim();
    return desc.length > 0 ? desc : null;
  }
}

// ─── Noise word filter ───────────────────────────────────────────────────────

const NOISE_WORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
  'instanceof', 'void', 'in', 'of', 'with', 'let', 'const', 'var', 'function',
  'class', 'extends', 'super', 'this', 'import', 'export', 'default', 'from',
  'as', 'async', 'await', 'yield', 'static', 'get', 'set', 'true', 'false',
  'null', 'undefined', 'NaN', 'Infinity', 'console', 'log', 'error', 'warn',
  'info', 'debug', 'trace', 'assert', 'Error', 'TypeError', 'ReferenceError',
  'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'at', 'the', 'is',
  'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having',
  'not', 'but', 'and', 'or', 'when', 'where', 'which', 'that', 'it',
]);

function isNoiseWord(word: string): boolean {
  return NOISE_WORDS.has(word);
}
