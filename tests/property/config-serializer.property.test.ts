import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ConfigSerializer } from '../../src/config/serializer.js';

/**
 * Property P2: 配置往返一致性
 * ∀ config ∈ ValidConfiguration:
 *   parse(serialize(config)) ≡ config
 *
 * **Validates: Requirements 9.4**
 */

const serializer = new ConfigSerializer();

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid provider name (word chars, hyphens, dots) */
const providerArb = fc.constantFrom('openai', 'anthropic', 'ollama', 'custom.ai', 'my-provider');

/** Generate a valid model name (word chars, hyphens, dots) */
const modelNameArb = fc.constantFrom(
  'gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet', 'codellama', 'llama2', 'mixtral-8x7b',
);

/** Generate a valid model identifier in `provider:model` format */
const modelArb = fc.tuple(providerArb, modelNameArb).map(([p, m]) => `${p}:${m}`);

/** Generate a positive integer for contextLimit */
const contextLimitArb = fc.integer({ min: 1, max: 1_000_000 });

/** Generate a single ignore pattern string (non-empty, safe for YAML) */
const ignorePatternArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./*'.split(''),
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((chars) => chars.join(''));

/** Generate an array of ignore patterns */
const ignorePatternsArb = fc.array(ignorePatternArb, { minLength: 0, maxLength: 8 });

/** Generate a non-empty API key string */
const apiKeyArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(''),
    ),
    { minLength: 1, maxLength: 64 },
  )
  .map((chars) => chars.join(''));

/** Generate a prompt template key */
const templateKeyArb = fc.constantFrom('analyze', 'fix', 'summarize', 'review', 'explain');

/** Generate a prompt template value (simple ASCII text) */
const templateValueArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?'.split(''),
    ),
    { minLength: 1, maxLength: 80 },
  )
  .map((chars) => chars.join(''));

/** Generate a promptTemplates record */
const promptTemplatesArb = fc
  .array(fc.tuple(templateKeyArb, templateValueArb), { minLength: 1, maxLength: 4 })
  .map((entries) => Object.fromEntries(entries));

/** Generate a valid Configuration object (required fields only) */
const requiredConfigArb = fc.record({
  model: modelArb,
  contextLimit: contextLimitArb,
  ignorePatterns: ignorePatternsArb,
});

/** Generate a valid Configuration object with optional fields */
const fullConfigArb = fc.record({
  model: modelArb,
  contextLimit: contextLimitArb,
  ignorePatterns: ignorePatternsArb,
  apiKey: fc.option(apiKeyArb, { nil: undefined }),
  promptTemplates: fc.option(promptTemplatesArb, { nil: undefined }),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('ConfigSerializer Property Tests', () => {
  it('P2: parse(serialize(config)) produces equivalent object for required-only configs', () => {
    fc.assert(
      fc.property(requiredConfigArb, (config) => {
        const yaml = serializer.serialize(config);
        const result = serializer.parse(yaml);

        expect(result.success).toBe(true);
        expect(result.data).toEqual(config);
      }),
      { numRuns: 200 },
    );
  });

  it('P2: parse(serialize(config)) produces equivalent object for full configs', () => {
    fc.assert(
      fc.property(fullConfigArb, (config) => {
        // Remove undefined optional fields so deep-equal works cleanly
        const cleaned = { ...config };
        if (cleaned.apiKey === undefined) delete cleaned.apiKey;
        if (cleaned.promptTemplates === undefined) delete cleaned.promptTemplates;

        const yaml = serializer.serialize(cleaned);
        const result = serializer.parse(yaml);

        expect(result.success).toBe(true);
        expect(result.data).toEqual(cleaned);
      }),
      { numRuns: 200 },
    );
  });
});
