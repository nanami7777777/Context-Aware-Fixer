import YAML from 'yaml';
import type { Configuration, ParseResult, ParseError } from '../types.js';
import { validateConfig } from './schema.js';

// ─── Config Serializer ──────────────────────────────────────────────────────

/**
 * Handles YAML ↔ Configuration object conversion.
 *
 * - `parse` validates the YAML structure and returns descriptive errors
 *   with line numbers when parsing fails.
 * - `serialize` produces a clean YAML string from a Configuration object.
 */
export class ConfigSerializer {
  /**
   * Parse a YAML string into a validated Configuration object.
   *
   * Returns a {@link ParseResult} with either the parsed config or
   * descriptive errors including line numbers and reasons.
   */
  parse(yaml: string): ParseResult<Configuration> {
    // 1. YAML syntax parsing
    let raw: unknown;
    try {
      raw = YAML.parse(yaml);
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
      return { success: false, errors };
    }

    // 2. Schema validation
    const validation = validateConfig(raw);
    if (!validation.valid) {
      const errors: ParseError[] = validation.errors.map((e) => ({
        field: e.field,
        message: e.message,
        suggestion: e.suggestion,
      }));
      return { success: false, errors };
    }

    // 3. Build Configuration with defaults for missing fields
    const obj = raw as Record<string, unknown>;
    const config: Configuration = {
      model: typeof obj.model === 'string' ? obj.model : 'openai:gpt-4',
      contextLimit: typeof obj.contextLimit === 'number' ? obj.contextLimit : 8000,
      ignorePatterns: Array.isArray(obj.ignorePatterns)
        ? (obj.ignorePatterns as string[])
        : ['node_modules', '.git', 'dist', 'build', 'coverage'],
    };

    if (typeof obj.apiKey === 'string') {
      config.apiKey = obj.apiKey;
    }

    if (
      obj.promptTemplates != null &&
      typeof obj.promptTemplates === 'object' &&
      !Array.isArray(obj.promptTemplates)
    ) {
      config.promptTemplates = obj.promptTemplates as Record<string, string>;
    }

    return { success: true, data: config };
  }

  /**
   * Serialize a Configuration object to a YAML string.
   */
  serialize(config: Configuration): string {
    // Build a clean object, omitting undefined optional fields
    const obj: Record<string, unknown> = {
      model: config.model,
      contextLimit: config.contextLimit,
      ignorePatterns: config.ignorePatterns,
    };

    if (config.apiKey !== undefined) {
      obj.apiKey = config.apiKey;
    }

    if (config.promptTemplates !== undefined) {
      obj.promptTemplates = config.promptTemplates;
    }

    return YAML.stringify(obj);
  }
}
