import type { ImportDeclaration } from '../../types.js';
import type { LanguageParser } from './registry.js';

/**
 * Rust use patterns:
 * - use crate::module;
 * - use crate::module::Item;
 * - use crate::module::{Item1, Item2};
 * - use crate::module::*;
 * - use super::module;
 * - use std::collections::HashMap;
 * - use external_crate::something;
 * - pub use ...;
 */

const USE_RE = /^[ \t]*(?:pub\s+)?use\s+([^;]+);/gm;

function lineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function isRelative(source: string): boolean {
  return source === 'self' || source === 'super' || source === 'crate'
    || source.startsWith('self::') || source.startsWith('super::') || source.startsWith('crate::');
}

function parseUsePath(raw: string): { source: string; specifiers: string[] } {
  const trimmed = raw.trim();

  // Handle grouped imports: path::{A, B, C}
  const braceMatch = trimmed.match(/^(.+?)::\{([^}]+)\}$/);
  if (braceMatch) {
    const basePath = braceMatch[1].trim();
    const specs = braceMatch[2]
      .split(',')
      .map(s => {
        const parts = s.trim().split(/\s+as\s+/);
        return parts[parts.length - 1].trim();
      })
      .filter(Boolean);
    return { source: basePath, specifiers: specs };
  }

  // Handle wildcard: path::*
  if (trimmed.endsWith('::*')) {
    const basePath = trimmed.slice(0, -3);
    return { source: basePath, specifiers: ['*'] };
  }

  // Handle alias: path::Item as Alias
  const asMatch = trimmed.match(/^(.+?)\s+as\s+(\w+)$/);
  if (asMatch) {
    const fullPath = asMatch[1].trim();
    const alias = asMatch[2];
    return { source: fullPath, specifiers: [alias] };
  }

  // Simple: path::Item or just path
  const parts = trimmed.split('::');
  const lastPart = parts[parts.length - 1];
  const source = parts.length > 1 ? parts.slice(0, -1).join('::') : trimmed;

  if (parts.length === 1) {
    return { source: trimmed, specifiers: [trimmed] };
  }

  return { source, specifiers: [lastPart] };
}

function parseContent(content: string): ImportDeclaration[] {
  const results: ImportDeclaration[] = [];

  let match: RegExpExecArray | null;
  USE_RE.lastIndex = 0;
  while ((match = USE_RE.exec(content)) !== null) {
    const { source, specifiers } = parseUsePath(match[1]);
    results.push({
      source,
      specifiers,
      line: lineNumber(content, match.index),
      isRelative: isRelative(source),
    });
  }

  return results;
}

export const rustParser: LanguageParser = {
  language: 'rust',
  extensions: ['.rs'],
  parseImports: parseContent,
};
