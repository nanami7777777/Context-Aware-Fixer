import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from './manager.js';
import { DEFAULT_CONFIG } from './schema.js';
import type { Configuration } from '../types.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// We mock fs/promises and os so tests don't touch the real filesystem.
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

import { readFile } from 'node:fs/promises';
const mockReadFile = vi.mocked(readFile);

// ─── Helpers ────────────────────────────────────────────────────────────────

function validYaml(overrides: Partial<Configuration> = {}): string {
  const lines: string[] = [];
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  lines.push(`model: "${cfg.model}"`);
  lines.push(`contextLimit: ${cfg.contextLimit}`);
  lines.push('ignorePatterns:');
  for (const p of cfg.ignorePatterns) {
    lines.push(`  - "${p}"`);
  }
  if (overrides.apiKey !== undefined) {
    lines.push(`apiKey: "${overrides.apiKey}"`);
  }
  if (overrides.promptTemplates !== undefined) {
    lines.push('promptTemplates:');
    for (const [k, v] of Object.entries(overrides.promptTemplates)) {
      lines.push(`  ${k}: "${v}"`);
    }
  }
  return lines.join('\n') + '\n';
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ConfigManager', () => {
  let manager: ConfigManager;

  beforeEach(() => {
    manager = new ConfigManager();
    mockReadFile.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── load — no config files ──

  it('returns defaults when no config files exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const config = await manager.load('/repo');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  // ── load — global config only ──

  it('merges global config over defaults', async () => {
    const globalYaml = validYaml({ model: 'anthropic:claude-3-sonnet', contextLimit: 16000 });

    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('/mock-home/')) return globalYaml;
      throw new Error('ENOENT');
    });

    const config = await manager.load('/repo');
    expect(config.model).toBe('anthropic:claude-3-sonnet');
    expect(config.contextLimit).toBe(16000);
    // defaults still apply for unset fields
    expect(config.ignorePatterns).toEqual(DEFAULT_CONFIG.ignorePatterns);
  });

  // ── load — project config only ──

  it('merges project config over defaults', async () => {
    const projectYaml = validYaml({ contextLimit: 4000, ignorePatterns: ['vendor'] });

    mockReadFile.mockImplementation(async (path) => {
      if (String(path).includes('/repo/')) return projectYaml;
      throw new Error('ENOENT');
    });

    const config = await manager.load('/repo');
    expect(config.contextLimit).toBe(4000);
    expect(config.ignorePatterns).toEqual(['vendor']);
    expect(config.model).toBe(DEFAULT_CONFIG.model);
  });

  // ── load — project overrides global ──

  it('project config takes priority over global config', async () => {
    const globalYaml = validYaml({ model: 'anthropic:claude-3-sonnet', contextLimit: 16000 });
    // Only set model in project — use a bare YAML so contextLimit is NOT present
    const projectYaml = 'model: "ollama:codellama"\n';

    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('/mock-home/')) return globalYaml;
      if (p.includes('/repo/')) return projectYaml;
      throw new Error('ENOENT');
    });

    const config = await manager.load('/repo');
    // project wins for model
    expect(config.model).toBe('ollama:codellama');
    // global wins for contextLimit (project didn't set it)
    expect(config.contextLimit).toBe(16000);
  });

  // ── load — optional fields merge ──

  it('merges apiKey from global when project does not set it', async () => {
    const globalYaml = validYaml({ apiKey: 'global-key' });
    const projectYaml = validYaml({ contextLimit: 2000 });

    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('/mock-home/')) return globalYaml;
      if (p.includes('/repo/')) return projectYaml;
      throw new Error('ENOENT');
    });

    const config = await manager.load('/repo');
    expect(config.apiKey).toBe('global-key');
    expect(config.contextLimit).toBe(2000);
  });

  it('project apiKey overrides global apiKey', async () => {
    const globalYaml = validYaml({ apiKey: 'global-key' });
    const projectYaml = validYaml({ apiKey: 'project-key' });

    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('/mock-home/')) return globalYaml;
      if (p.includes('/repo/')) return projectYaml;
      throw new Error('ENOENT');
    });

    const config = await manager.load('/repo');
    expect(config.apiKey).toBe('project-key');
  });

  // ── load — invalid config files ──

  it('throws with details when global config is invalid YAML', async () => {
    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('/mock-home/')) return 'model: [invalid\n';
      throw new Error('ENOENT');
    });

    await expect(manager.load('/repo')).rejects.toThrow(/Invalid configuration/);
  });

  it('throws with details when project config has schema errors', async () => {
    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('/mock-home/')) throw new Error('ENOENT');
      if (p.includes('/repo/')) return 'model: "no-colon"\n';
      throw new Error('ENOENT');
    });

    await expect(manager.load('/repo')).rejects.toThrow(/Invalid configuration/);
    await expect(manager.load('/repo')).rejects.toThrow(/model/);
  });

  it('error message includes suggestion when available', async () => {
    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes('/repo/')) return 'contextLimit: -5\n';
      throw new Error('ENOENT');
    });

    await expect(manager.load('/repo')).rejects.toThrow(/Suggestion/);
  });

  // ── validate ──

  it('validate delegates to schema validateConfig', () => {
    const result = manager.validate({ model: 'openai:gpt-4', contextLimit: 8000, ignorePatterns: [] });
    expect(result.valid).toBe(true);
  });

  it('validate returns errors for invalid input', () => {
    const result = manager.validate(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validate returns errors for bad field values', () => {
    const result = manager.validate({ model: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'model')).toBe(true);
  });
});
