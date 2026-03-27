import { describe, it, expect } from 'vitest';
import { ConfigSerializer } from './serializer.js';
import type { Configuration } from '../types.js';

const serializer = new ConfigSerializer();

// ─── parse — happy paths ────────────────────────────────────────────────────

describe('ConfigSerializer.parse', () => {
  it('parses a minimal valid YAML config', () => {
    const yaml = `model: "openai:gpt-4"\ncontextLimit: 4000\nignorePatterns: []\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      model: 'openai:gpt-4',
      contextLimit: 4000,
      ignorePatterns: [],
    });
  });

  it('parses a full valid YAML config', () => {
    const yaml = [
      'model: "anthropic:claude-3-sonnet"',
      'apiKey: "sk-abc123"',
      'contextLimit: 16000',
      'ignorePatterns:',
      '  - node_modules',
      '  - "*.log"',
      'promptTemplates:',
      '  analyze: "Analyze this bug"',
      '  fix: "Fix this bug"',
    ].join('\n');

    const result = serializer.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.data!.model).toBe('anthropic:claude-3-sonnet');
    expect(result.data!.apiKey).toBe('sk-abc123');
    expect(result.data!.contextLimit).toBe(16000);
    expect(result.data!.ignorePatterns).toEqual(['node_modules', '*.log']);
    expect(result.data!.promptTemplates).toEqual({ analyze: 'Analyze this bug', fix: 'Fix this bug' });
  });

  it('applies defaults for missing optional fields', () => {
    const yaml = `contextLimit: 2000\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.data!.model).toBe('openai:gpt-4');
    expect(result.data!.contextLimit).toBe(2000);
    expect(result.data!.ignorePatterns).toContain('node_modules');
    expect(result.data!.apiKey).toBeUndefined();
    expect(result.data!.promptTemplates).toBeUndefined();
  });

  // ── parse — YAML syntax errors ──

  it('returns error with line number for invalid YAML syntax', () => {
    const yaml = `model: "openai:gpt-4"\ncontextLimit: [\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0]!.field).toBe('yaml');
    expect(result.errors![0]!.message).toMatch(/YAML syntax error/);
  });

  it('returns error for completely broken YAML', () => {
    const yaml = `:\n  - :\n    - : :\n`;
    const result = serializer.parse(yaml);
    // This may parse as a weird structure but fail validation
    // or it may fail YAML parsing — either way, success should be false
    // if it happens to parse, the schema validator will catch it
    expect(result.success).toBe(false);
  });

  // ── parse — schema validation errors ──

  it('returns error for invalid model format', () => {
    const yaml = `model: "gpt-4"\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(false);
    expect(result.errors!.some(e => e.field === 'model')).toBe(true);
  });

  it('returns error for negative contextLimit', () => {
    const yaml = `contextLimit: -100\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(false);
    expect(result.errors!.some(e => e.field === 'contextLimit')).toBe(true);
  });

  it('returns error for non-object input (array YAML)', () => {
    const yaml = `- item1\n- item2\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(false);
    expect(result.errors!.some(e => e.field === 'config')).toBe(true);
  });

  it('returns error for empty apiKey', () => {
    const yaml = `apiKey: ""\n`;
    const result = serializer.parse(yaml);
    expect(result.success).toBe(false);
    expect(result.errors!.some(e => e.field === 'apiKey')).toBe(true);
  });
});

// ─── serialize ──────────────────────────────────────────────────────────────

describe('ConfigSerializer.serialize', () => {
  it('serializes a minimal config to valid YAML', () => {
    const config: Configuration = {
      model: 'openai:gpt-4',
      contextLimit: 8000,
      ignorePatterns: ['node_modules'],
    };
    const yaml = serializer.serialize(config);
    expect(yaml).toContain('model: openai:gpt-4');
    expect(yaml).toContain('contextLimit: 8000');
    expect(yaml).toContain('node_modules');
  });

  it('serializes a full config including optional fields', () => {
    const config: Configuration = {
      model: 'anthropic:claude-3-sonnet',
      apiKey: 'sk-test',
      contextLimit: 16000,
      ignorePatterns: ['dist', 'build'],
      promptTemplates: { analyze: 'Do analysis' },
    };
    const yaml = serializer.serialize(config);
    expect(yaml).toContain('apiKey: sk-test');
    expect(yaml).toContain('promptTemplates');
    expect(yaml).toContain('analyze: Do analysis');
  });

  it('omits undefined optional fields', () => {
    const config: Configuration = {
      model: 'openai:gpt-4',
      contextLimit: 8000,
      ignorePatterns: [],
    };
    const yaml = serializer.serialize(config);
    expect(yaml).not.toContain('apiKey');
    expect(yaml).not.toContain('promptTemplates');
  });
});

// ─── round-trip ─────────────────────────────────────────────────────────────

describe('ConfigSerializer round-trip', () => {
  it('parse(serialize(config)) produces equivalent object', () => {
    const config: Configuration = {
      model: 'openai:gpt-4',
      contextLimit: 8000,
      ignorePatterns: ['node_modules', '.git'],
    };
    const yaml = serializer.serialize(config);
    const result = serializer.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(config);
  });

  it('round-trips a config with all optional fields', () => {
    const config: Configuration = {
      model: 'ollama:codellama',
      apiKey: 'my-key',
      contextLimit: 4000,
      ignorePatterns: ['dist'],
      promptTemplates: { fix: 'Fix it' },
    };
    const yaml = serializer.serialize(config);
    const result = serializer.parse(yaml);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(config);
  });
});
