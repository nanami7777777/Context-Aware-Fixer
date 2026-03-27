import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, validateConfig } from './schema.js';

// ─── Default Config ─────────────────────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_CONFIG.model).toBe('openai:gpt-4');
    expect(DEFAULT_CONFIG.contextLimit).toBe(8000);
    expect(DEFAULT_CONFIG.ignorePatterns).toContain('node_modules');
    expect(DEFAULT_CONFIG.ignorePatterns).toContain('.git');
  });

  it('passes its own validation', () => {
    const result = validateConfig(DEFAULT_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── validateConfig ─────────────────────────────────────────────────────────

describe('validateConfig', () => {
  // ── Happy paths ──

  it('accepts a minimal valid config', () => {
    const result = validateConfig({ model: 'openai:gpt-4', contextLimit: 4000, ignorePatterns: [] });
    expect(result.valid).toBe(true);
  });

  it('accepts a full valid config', () => {
    const result = validateConfig({
      model: 'anthropic:claude-3-sonnet',
      apiKey: 'sk-abc123',
      contextLimit: 16000,
      ignorePatterns: ['node_modules', '*.log'],
      promptTemplates: { analyze: 'Analyze this bug', fix: 'Fix this bug' },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts config with only some fields (others use defaults)', () => {
    const result = validateConfig({ contextLimit: 2000 });
    expect(result.valid).toBe(true);
  });

  // ── Non-object inputs ──

  it('rejects null', () => {
    const result = validateConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe('config');
  });

  it('rejects undefined', () => {
    const result = validateConfig(undefined);
    expect(result.valid).toBe(false);
  });

  it('rejects arrays', () => {
    const result = validateConfig([1, 2, 3]);
    expect(result.valid).toBe(false);
  });

  it('rejects primitives', () => {
    expect(validateConfig('string').valid).toBe(false);
    expect(validateConfig(42).valid).toBe(false);
  });

  // ── model field ──

  it('rejects non-string model', () => {
    const result = validateConfig({ model: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'model')).toBe(true);
  });

  it('rejects model without provider:model format', () => {
    const result = validateConfig({ model: 'gpt-4' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'model')).toBe(true);
  });

  it('warns on unknown provider', () => {
    const result = validateConfig({ model: 'custom:my-model' });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('Unknown provider'))).toBe(true);
  });

  // ── apiKey field ──

  it('rejects non-string apiKey', () => {
    const result = validateConfig({ apiKey: 42 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'apiKey')).toBe(true);
  });

  it('rejects empty apiKey', () => {
    const result = validateConfig({ apiKey: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'apiKey')).toBe(true);
  });

  // ── contextLimit field ──

  it('rejects non-integer contextLimit', () => {
    const result = validateConfig({ contextLimit: 3.14 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'contextLimit')).toBe(true);
  });

  it('rejects zero contextLimit', () => {
    const result = validateConfig({ contextLimit: 0 });
    expect(result.valid).toBe(false);
  });

  it('rejects negative contextLimit', () => {
    const result = validateConfig({ contextLimit: -100 });
    expect(result.valid).toBe(false);
  });

  it('rejects string contextLimit', () => {
    const result = validateConfig({ contextLimit: '8000' });
    expect(result.valid).toBe(false);
  });

  // ── ignorePatterns field ──

  it('rejects non-array ignorePatterns', () => {
    const result = validateConfig({ ignorePatterns: 'node_modules' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'ignorePatterns')).toBe(true);
  });

  it('rejects ignorePatterns with non-string elements', () => {
    const result = validateConfig({ ignorePatterns: ['valid', 42] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'ignorePatterns[1]')).toBe(true);
  });

  // ── promptTemplates field ──

  it('rejects non-object promptTemplates', () => {
    const result = validateConfig({ promptTemplates: 'not-an-object' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'promptTemplates')).toBe(true);
  });

  it('rejects promptTemplates with non-string values', () => {
    const result = validateConfig({ promptTemplates: { analyze: 123 } });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'promptTemplates.analyze')).toBe(true);
  });

  // ── Unknown fields ──

  it('warns about unknown fields', () => {
    const result = validateConfig({ unknownField: true });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('unknownField'))).toBe(true);
  });
});
