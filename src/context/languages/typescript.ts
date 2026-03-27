import type { ImportDeclaration } from '../../types.js';
import type { LanguageParser } from './registry.js';

/**
 * Regex patterns for TypeScript/JavaScript imports:
 * - ES module: import ... from 'source'
 * - Side-effect: import 'source'
 * - Dynamic: import('source')  (not captured as static import)
 * - CommonJS: require('source')
 * - Re-export: export ... from 'source'
 */

// import { a, b } from 'source'
// import defaultExport from 'source'
// import * as name from 'source'
// import type { Foo } from 'source'
const ES_IMPORT_RE = /^[ \t]*import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/gm;

// import 'source' (side-effect)
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+['"]([^'"]+)['"]/gm;

// const x = require('source')  /  require('source')
const REQUIRE_RE = /(?:^|[=,;\s])require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

// export { a } from 'source'  /  export * from 'source'
const REEXPORT_RE = /^[ \t]*export\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/gm;

function isRelative(source: string): boolean {
  return source.startsWith('.') || source.startsWith('/');
}

function lineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function parseSpecifiers(raw: string): string[] {
  const trimmed = raw.trim();

  // import * as name
  if (trimmed.startsWith('*')) {
    const match = trimmed.match(/\*\s+as\s+(\w+)/);
    return match ? [match[1]] : ['*'];
  }

  // import { a, b, c as d }
  const braceMatch = trimmed.match(/\{([^}]+)\}/);
  if (braceMatch) {
    const specs = braceMatch[1].split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    }).filter(Boolean);

    // Also check for default import before braces: import Default, { a, b }
    const beforeBrace = trimmed.slice(0, trimmed.indexOf('{')).replace(/,\s*$/, '').trim();
    if (beforeBrace && !beforeBrace.startsWith('type')) {
      return [beforeBrace, ...specs];
    }
    return specs;
  }

  // import defaultExport
  if (/^\w+$/.test(trimmed)) {
    return [trimmed];
  }

  return [];
}

function parseContent(content: string): ImportDeclaration[] {
  const results: ImportDeclaration[] = [];
  const seen = new Set<string>();

  // ES imports with specifiers
  let match: RegExpExecArray | null;
  ES_IMPORT_RE.lastIndex = 0;
  while ((match = ES_IMPORT_RE.exec(content)) !== null) {
    const key = `es:${match.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      source: match[2],
      specifiers: parseSpecifiers(match[1]),
      line: lineNumber(content, match.index),
      isRelative: isRelative(match[2]),
    });
  }

  // Side-effect imports
  SIDE_EFFECT_IMPORT_RE.lastIndex = 0;
  while ((match = SIDE_EFFECT_IMPORT_RE.exec(content)) !== null) {
    // Skip if already captured by ES_IMPORT_RE
    const line = lineNumber(content, match.index);
    if (results.some(r => r.line === line)) continue;
    results.push({
      source: match[1],
      specifiers: [],
      line,
      isRelative: isRelative(match[1]),
    });
  }

  // require() calls
  REQUIRE_RE.lastIndex = 0;
  while ((match = REQUIRE_RE.exec(content)) !== null) {
    results.push({
      source: match[1],
      specifiers: [],
      line: lineNumber(content, match.index),
      isRelative: isRelative(match[1]),
    });
  }

  // Re-exports
  REEXPORT_RE.lastIndex = 0;
  while ((match = REEXPORT_RE.exec(content)) !== null) {
    results.push({
      source: match[1],
      specifiers: [],
      line: lineNumber(content, match.index),
      isRelative: isRelative(match[1]),
    });
  }

  return results.sort((a, b) => a.line - b.line);
}

export const typescriptParser: LanguageParser = {
  language: 'typescript',
  extensions: ['.ts', '.tsx', '.mts', '.cts'],
  parseImports: parseContent,
};

export const javascriptParser: LanguageParser = {
  language: 'javascript',
  extensions: ['.js', '.jsx', '.mjs', '.cjs'],
  parseImports: parseContent,
};
