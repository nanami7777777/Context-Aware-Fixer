import { describe, it, expect } from 'vitest';
import { InputParser } from './parser.js';

const parser = new InputParser();

describe('InputParser.parse', () => {
  it('returns error for empty input', () => {
    const result = parser.parse('', 'cli-arg');
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].field).toBe('rawInput');
  });

  it('extracts error type from error message', () => {
    const result = parser.parse('TypeError: Cannot read properties of undefined', 'cli-arg');
    expect(result.success).toBe(true);
    expect(result.data!.errorType).toBe('TypeError');
  });

  it('extracts error message text', () => {
    const result = parser.parse('ReferenceError: foo is not defined', 'cli-arg');
    expect(result.success).toBe(true);
    expect(result.data!.errorMessage).toBe('foo is not defined');
  });

  it('extracts file paths with line numbers', () => {
    const result = parser.parse('Error in src/app.ts:42', 'cli-arg');
    expect(result.success).toBe(true);
    const paths = result.data!.filePaths;
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const ref = paths.find((p) => p.path === 'src/app.ts');
    expect(ref).toBeDefined();
    expect(ref!.line).toBe(42);
  });

  it('extracts file paths with line and column', () => {
    const result = parser.parse('Error at ./src/utils/helper.ts:10:5', 'cli-arg');
    expect(result.success).toBe(true);
    const ref = result.data!.filePaths.find((p) => p.path === './src/utils/helper.ts');
    expect(ref).toBeDefined();
    expect(ref!.line).toBe(10);
    expect(ref!.column).toBe(5);
  });

  it('parses stack trace frames with function names', () => {
    const input = `TypeError: Cannot read properties of undefined
    at processData (/home/user/project/src/data.ts:15:3)
    at main (/home/user/project/src/index.ts:42:10)`;

    const result = parser.parse(input, 'stdin');
    expect(result.success).toBe(true);
    const frames = result.data!.stackTrace!;
    expect(frames).toHaveLength(2);
    expect(frames[0].functionName).toBe('processData');
    expect(frames[0].filePath).toBe('/home/user/project/src/data.ts');
    expect(frames[0].line).toBe(15);
    expect(frames[1].functionName).toBe('main');
    expect(frames[1].line).toBe(42);
  });

  it('parses stack trace frames without function names', () => {
    const input = `Error: something broke
    at /home/user/project/src/index.ts:5:1`;

    const result = parser.parse(input, 'cli-arg');
    expect(result.success).toBe(true);
    const frames = result.data!.stackTrace!;
    expect(frames).toHaveLength(1);
    expect(frames[0].functionName).toBeUndefined();
    expect(frames[0].filePath).toBe('/home/user/project/src/index.ts');
    expect(frames[0].line).toBe(5);
  });

  it('preserves stack trace order', () => {
    const input = `Error: fail
    at alpha (/a.ts:1:1)
    at beta (/b.ts:2:2)
    at gamma (/c.ts:3:3)`;

    const result = parser.parse(input, 'cli-arg');
    const frames = result.data!.stackTrace!;
    expect(frames.map((f) => f.functionName)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('extracts keywords from natural language description', () => {
    const input = 'The UserService.fetchProfile() method in user-service.ts throws when called with null';
    const result = parser.parse(input, 'cli-arg');
    expect(result.success).toBe(true);
    expect(result.data!.keywords).toContain('user-service.ts');
    expect(result.data!.keywords.some((k) => k.includes('UserService'))).toBe(true);
  });

  it('extracts description from non-stack-trace lines', () => {
    const input = `The app crashes when I click submit.
TypeError: Cannot read properties of undefined
    at handleSubmit (src/form.ts:20:5)`;

    const result = parser.parse(input, 'file');
    expect(result.success).toBe(true);
    expect(result.data!.description).toBeDefined();
    expect(result.data!.description).toContain('app crashes');
  });

  it('sets source correctly', () => {
    const result = parser.parse('some error', 'stdin');
    expect(result.data!.source).toBe('stdin');
  });

  it('deduplicates file paths', () => {
    const input = `Error in src/app.ts:10
Also see src/app.ts:10 for details`;
    const result = parser.parse(input, 'cli-arg');
    const appRefs = result.data!.filePaths.filter(
      (p) => p.path === 'src/app.ts' && p.line === 10,
    );
    expect(appRefs).toHaveLength(1);
  });
});

describe('InputParser.validate', () => {
  it('returns valid when file paths are present', () => {
    const report = parser.parse(
      'TypeError: fail at src/app.ts:10',
      'cli-arg',
    ).data!;
    const result = parser.validate(report);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid when no file paths or stack trace', () => {
    const report = parser.parse('something is broken', 'cli-arg').data!;
    const result = parser.validate(report);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].suggestion).toBeDefined();
  });

  it('warns when no error type or message', () => {
    const report = parser.parse('check src/app.ts:5', 'cli-arg').data!;
    const result = parser.validate(report);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('valid when stack trace present but no explicit file paths', () => {
    const input = `Error: boom
    at run (/project/src/main.ts:1:1)`;
    const report = parser.parse(input, 'cli-arg').data!;
    const result = parser.validate(report);
    expect(result.valid).toBe(true);
  });
});
