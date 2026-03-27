import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ConfigSerializer } from '../../src/config/serializer.js';
import type { Configuration } from '../../src/types.js';

/**
 * Property P8: 配置合并优先级
 * ∀ projectConfig, globalConfig ∈ Configuration:
 *   ∀ field ∈ projectConfig 且 field ∈ globalConfig:
 *     merge(projectConfig, globalConfig)[field] == projectConfig[field]
 *
 * **Validates: Requirements 8.3**
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

import { readFile } from 'node:fs/promises';
import { ConfigManager } from '../../src/config/manager.js';

const mockReadFile = vi.mocked(readFile);
const serializer = new ConfigSerializer();

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid provider:model identifier */
const modelArb = fc
  .tuple(
    fc.constantFrom('openai', 'anthropic', 'ollama'),
    fc.constantFrom('gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet', 'codellama'),
  )
  .map(([p, m]) => `${p}:${m}`);

/** Generate a positive integer for contextLimit */
const contextLimitArb = fc.integer({ min: 1, max: 1_000_000 });

/** Generate a single ignore pattern string */
const ignorePatternArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789_-.*'.split(''),
    ),
    { minLength: 1, maxLength: 20 },
  )
  .map((chars) => chars.join(''));

/** Generate an array of ignore patterns */
const ignorePatternsArb = fc.array(ignorePatternArb, { minLength: 1, maxLength: 5 });

/** Generate a non-empty API key string */
const apiKeyArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split(''),
    ),
    { minLength: 1, maxLength: 40 },
  )
  .map((chars) => chars.join(''));

/** Generate a prompt template key */
const templateKeyArb = fc.constantFrom('analyze', 'fix', 'summarize', 'review');

/** Generate a prompt template value */
const templateValueArb = fc
  .array(
    fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.'.split(''),
    ),
    { minLength: 1, maxLength: 40 },
  )
  .map((chars) => chars.join(''));

/** Generate a promptTemplates record */
const promptTemplatesArb = fc
  .array(fc.tuple(templateKeyArb, templateValueArb), { minLength: 1, maxLength: 3 })
  .map((entries) => Object.fromEntries(entries));

/** Generate a valid Configuration with all fields present (required + optional) */
const fullConfigArb = fc.record({
  model: modelArb,
  contextLimit: contextLimitArb,
  ignorePatterns: ignorePatternsArb,
  apiKey: apiKeyArb,
  promptTemplates: promptTemplatesArb,
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('ConfigManager Merge Priority Property Tests', () => {
  let manager: ConfigManager;

  beforeEach(() => {
    manager = new ConfigManager();
    mockReadFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('P8: project config fields override global config fields for every shared field', async () => {
    await fc.assert(
      fc.asyncProperty(fullConfigArb, fullConfigArb, async (projectConfig, globalConfig) => {
        const projectYaml = serializer.serialize(projectConfig);
        const globalYaml = serializer.serialize(globalConfig);

        mockReadFile.mockImplementation(async (path) => {
          const p = String(path);
          if (p.includes('/mock-home/')) return globalYaml;
          if (p.includes('/test-repo/')) return projectYaml;
          throw new Error('ENOENT');
        });

        const merged = await manager.load('/test-repo');

        // Every field present in projectConfig must win over globalConfig
        expect(merged.model).toBe(projectConfig.model);
        expect(merged.contextLimit).toBe(projectConfig.contextLimit);
        expect(merged.ignorePatterns).toEqual(projectConfig.ignorePatterns);
        expect(merged.apiKey).toBe(projectConfig.apiKey);
        expect(merged.promptTemplates).toEqual(projectConfig.promptTemplates);
      }),
      { numRuns: 100 },
    );
  });
});
