import type { ImportDeclaration } from '../../types.js';
import type { LanguageParser } from './registry.js';

/**
 * Python import patterns:
 * - import module
 * - import module as alias
 * - from module import name
 * - from module import name as alias
 * - from module import (name1, name2)
 * - from . import module  (relative)
 * - from ..module import name  (relative)
 */

// from module import ...
const FROM_IMPORT_RE = /^[ \t]*from\s+(\.{0,3}\w[\w.]*|\.{1,3})\s+import\s+(.+)/gm;

// import module  /  import module as alias  /  import mod1, mod2
const PLAIN_IMPORT_RE = /^[ \t]*import\s+([^(#\n]+)/gm;

function isRelative(source: string): boolean {
  return source.startsWith('.');
}

function lineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function parseFromImportSpecifiers(raw: string): string[] {
  // Handle parenthesized imports: from x import (a, b, c)
  let cleaned = raw.replace(/[()]/g, '');
  // Remove comments
  cleaned = cleaned.replace(/#.*$/, '');
  return cleaned
    .split(',')
    .map(s => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    })
    .filter(s => s.length > 0 && s !== '*');
}

function parseContent(content: string): ImportDeclaration[] {
  const results: ImportDeclaration[] = [];
  const seenLines = new Set<number>();

  let match: RegExpExecArray | null;

  // from ... import ...
  FROM_IMPORT_RE.lastIndex = 0;
  while ((match = FROM_IMPORT_RE.exec(content)) !== null) {
    const line = lineNumber(content, match.index);
    seenLines.add(line);

    const source = match[1];
    const specPart = match[2].trim();

    // Handle wildcard: from module import *
    const specifiers = specPart === '*' ? ['*'] : parseFromImportSpecifiers(specPart);

    results.push({
      source,
      specifiers,
      line,
      isRelative: isRelative(source),
    });
  }

  // import module
  PLAIN_IMPORT_RE.lastIndex = 0;
  while ((match = PLAIN_IMPORT_RE.exec(content)) !== null) {
    const line = lineNumber(content, match.index);
    if (seenLines.has(line)) continue;

    const raw = match[1].replace(/#.*$/, '').trim();
    // import mod1, mod2 as alias
    const modules = raw.split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[0].trim();
    }).filter(Boolean);

    for (const mod of modules) {
      results.push({
        source: mod,
        specifiers: [],
        line,
        isRelative: isRelative(mod),
      });
    }
  }

  return results.sort((a, b) => a.line - b.line);
}

export const pythonParser: LanguageParser = {
  language: 'python',
  extensions: ['.py', '.pyw'],
  parseImports: parseContent,
};
