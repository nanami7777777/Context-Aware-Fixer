import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import type { Configuration, ValidationResult, ParseError } from '../types.js';
import { validateConfig, DEFAULT_CONFIG } from './schema.js';

// ─── Config Manager ─────────────────────────────────────────────────────────

/** Project-level config filename. */
const PROJECT_CONFIG_FILE = '.contextfix.yml';

/** Global config filename (resolved under `$HOME`). */
const GLOBAL_CONFIG_FILE = '.contextfix.yml';

/**
 * Loads, merges, and validates ContextFix configuration.
 *
 * Merge priority: project-level `.contextfix.yml` > global `~/.contextfix.yml` > defaults.
 */
export class ConfigManager {
  /**
   * Load the merged configuration for a repository.
   *
   * 1. Read global config from `~/.contextfix.yml` (if it exists).
   * 2. Read project config from `<repoPath>/.contextfix.yml` (if it exists).
   * 3. Merge: defaults ← global ← project (only explicitly set fields).
   *
   * Throws if a config file exists but contains invalid YAML or schema errors.
   */
  async load(repoPath: string): Promise<Configuration> {
    const globalPath = join(homedir(), GLOBAL_CONFIG_FILE);
    const projectPath = join(repoPath, PROJECT_CONFIG_FILE);

    const globalFields = await this.readConfigFile(globalPath);
    const projectFields = await this.readConfigFile(projectPath);

    return this.merge(DEFAULT_CONFIG, globalFields, projectFields);
  }

  /**
   * Validate an unknown value against the Configuration schema.
   */
  validate(config: unknown): ValidationResult {
    return validateConfig(config);
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Read and validate a YAML config file, returning only the fields
   * explicitly present in the file (no defaults applied).
   *
   * Returns `null` when the file does not exist.
   * Throws a descriptive error when the file exists but is invalid.
   */
  private async readConfigFile(
    filePath: string,
  ): Promise<Record<string, unknown> | null> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      // File doesn't exist or is unreadable — treat as absent.
      return null;
    }

    // 1. Parse YAML syntax
    let raw: unknown;
    try {
      raw = YAML.parse(content);
    } catch (err) {
      const errors: ParseError[] = [];
      if (err instanceof YAML.YAMLParseError) {
        const line = err.linePos?.[0]?.line;
        errors.push({
          field: 'yaml',
          message: line != null
            ? `YAML syntax error at line ${line}: ${err.message}`
            : `YAML syntax error: ${err.message}`,
          suggestion: 'Check the YAML syntax around the indicated line.',
        });
      } else {
        errors.push({
          field: 'yaml',
          message: `YAML parsing failed: ${String(err)}`,
        });
      }
      throw this.buildError(filePath, errors);
    }

    // 2. Schema validation
    const validation = validateConfig(raw);
    if (!validation.valid) {
      const errors: ParseError[] = validation.errors.map((e) => ({
        field: e.field,
        message: e.message,
        suggestion: e.suggestion,
      }));
      throw this.buildError(filePath, errors);
    }

    // Return the raw parsed object — only contains fields the user wrote.
    return raw as Record<string, unknown>;
  }

  /**
   * Build a descriptive Error from a list of parse/validation errors.
   */
  private buildError(filePath: string, errors: ParseError[]): Error {
    const details = errors
      .map((e) => {
        let msg = `  - [${e.field}] ${e.message}`;
        if (e.suggestion) msg += `\n    Suggestion: ${e.suggestion}`;
        return msg;
      })
      .join('\n');
    return new Error(`Invalid configuration in ${filePath}:\n${details}`);
  }

  /**
   * Merge configuration layers. Only fields explicitly present in each
   * layer override the previous value. Defaults ← global ← project.
   */
  private merge(
    defaults: Readonly<Configuration>,
    global: Record<string, unknown> | null,
    project: Record<string, unknown> | null,
  ): Configuration {
    const merged: Configuration = { ...defaults };

    for (const layer of [global, project]) {
      if (layer == null) continue;
      if ('model' in layer && typeof layer.model === 'string') {
        merged.model = layer.model;
      }
      if ('apiKey' in layer && typeof layer.apiKey === 'string') {
        merged.apiKey = layer.apiKey;
      }
      if ('contextLimit' in layer && typeof layer.contextLimit === 'number') {
        merged.contextLimit = layer.contextLimit;
      }
      if ('ignorePatterns' in layer && Array.isArray(layer.ignorePatterns)) {
        merged.ignorePatterns = layer.ignorePatterns as string[];
      }
      if (
        'promptTemplates' in layer &&
        layer.promptTemplates != null &&
        typeof layer.promptTemplates === 'object' &&
        !Array.isArray(layer.promptTemplates)
      ) {
        merged.promptTemplates = layer.promptTemplates as Record<string, string>;
      }
    }

    return merged;
  }
}
