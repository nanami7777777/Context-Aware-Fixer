import type { Configuration, ValidationResult, ValidationError } from '../types.js';

// ─── Default Configuration ──────────────────────────────────────────────────

/** Default values for all configuration fields. */
export const DEFAULT_CONFIG: Readonly<Configuration> = {
  model: 'openai:gpt-4',
  contextLimit: 8000,
  ignorePatterns: ['node_modules', '.git', 'dist', 'build', 'coverage'],
};

// ─── Validation Helpers ─────────────────────────────────────────────────────

/**
 * Model identifier must follow the `provider:model` format.
 * Provider and model segments must each contain at least one character
 * composed of word characters, hyphens, or dots.
 */
const MODEL_PATTERN = /^[\w.-]+:[\w.-]+$/;

/** Known provider prefixes (used for warnings, not hard failures). */
const KNOWN_PROVIDERS = new Set(['openai', 'anthropic', 'ollama']);

// ─── Schema Validator ───────────────────────────────────────────────────────

/**
 * Validate a raw (unknown) object against the Configuration schema.
 *
 * Returns a {@link ValidationResult} with field-level errors and warnings.
 * A result with `valid: true` guarantees the object satisfies the
 * {@link Configuration} interface contract.
 */
export function validateConfig(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({
      field: 'config',
      message: 'Configuration must be a non-null object.',
      suggestion: 'Provide a valid YAML configuration object.',
    });
    return { valid: false, errors, warnings };
  }

  const obj = raw as Record<string, unknown>;

  validateModel(obj, errors, warnings);
  validateApiKey(obj, errors);
  validateContextLimit(obj, errors);
  validateIgnorePatterns(obj, errors);
  validatePromptTemplates(obj, errors);
  checkUnknownFields(obj, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Per-Field Validators ───────────────────────────────────────────────────

function validateModel(
  obj: Record<string, unknown>,
  errors: ValidationError[],
  warnings: string[],
): void {
  if (!('model' in obj)) return; // optional — defaults apply

  if (typeof obj.model !== 'string') {
    errors.push({
      field: 'model',
      message: 'model must be a string.',
      suggestion: 'Use the format "provider:model", e.g. "openai:gpt-4".',
    });
    return;
  }

  if (!MODEL_PATTERN.test(obj.model)) {
    errors.push({
      field: 'model',
      message: `Invalid model identifier "${obj.model}".`,
      suggestion: 'Use the format "provider:model", e.g. "openai:gpt-4" or "ollama:codellama".',
    });
    return;
  }

  const provider = obj.model.split(':')[0];
  if (!KNOWN_PROVIDERS.has(provider!)) {
    warnings.push(
      `Unknown provider "${provider}". Known providers: ${[...KNOWN_PROVIDERS].join(', ')}.`,
    );
  }
}

function validateApiKey(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (!('apiKey' in obj) || obj.apiKey === undefined) return;

  if (typeof obj.apiKey !== 'string') {
    errors.push({
      field: 'apiKey',
      message: 'apiKey must be a string.',
    });
    return;
  }

  if (obj.apiKey.length === 0) {
    errors.push({
      field: 'apiKey',
      message: 'apiKey must not be empty when provided.',
      suggestion: 'Set a valid API key or remove the field to omit it.',
    });
  }
}

function validateContextLimit(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (!('contextLimit' in obj)) return;

  if (typeof obj.contextLimit !== 'number' || !Number.isInteger(obj.contextLimit)) {
    errors.push({
      field: 'contextLimit',
      message: 'contextLimit must be a positive integer.',
      suggestion: 'Set contextLimit to a whole number, e.g. 8000.',
    });
    return;
  }

  if (obj.contextLimit <= 0) {
    errors.push({
      field: 'contextLimit',
      message: 'contextLimit must be greater than 0.',
      suggestion: 'Use a positive value such as 4000 or 8000.',
    });
  }
}

function validateIgnorePatterns(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (!('ignorePatterns' in obj)) return;

  if (!Array.isArray(obj.ignorePatterns)) {
    errors.push({
      field: 'ignorePatterns',
      message: 'ignorePatterns must be an array of strings.',
      suggestion: 'Provide a list like ["node_modules", "dist"].',
    });
    return;
  }

  for (let i = 0; i < obj.ignorePatterns.length; i++) {
    if (typeof obj.ignorePatterns[i] !== 'string') {
      errors.push({
        field: `ignorePatterns[${i}]`,
        message: `ignorePatterns[${i}] must be a string, got ${typeof obj.ignorePatterns[i]}.`,
      });
    }
  }
}

function validatePromptTemplates(
  obj: Record<string, unknown>,
  errors: ValidationError[],
): void {
  if (!('promptTemplates' in obj) || obj.promptTemplates === undefined) return;

  if (
    obj.promptTemplates === null ||
    typeof obj.promptTemplates !== 'object' ||
    Array.isArray(obj.promptTemplates)
  ) {
    errors.push({
      field: 'promptTemplates',
      message: 'promptTemplates must be an object mapping template names to strings.',
      suggestion: 'Use a map like { analyze: "Your prompt here" }.',
    });
    return;
  }

  const templates = obj.promptTemplates as Record<string, unknown>;
  for (const [key, value] of Object.entries(templates)) {
    if (typeof value !== 'string') {
      errors.push({
        field: `promptTemplates.${key}`,
        message: `promptTemplates.${key} must be a string, got ${typeof value}.`,
      });
    }
  }
}

// ─── Unknown Field Detection ────────────────────────────────────────────────

const KNOWN_FIELDS = new Set<string>([
  'model',
  'apiKey',
  'contextLimit',
  'ignorePatterns',
  'promptTemplates',
]);

function checkUnknownFields(
  obj: Record<string, unknown>,
  warnings: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!KNOWN_FIELDS.has(key)) {
      warnings.push(`Unknown configuration field "${key}" will be ignored.`);
    }
  }
}
