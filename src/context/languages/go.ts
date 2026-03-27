import type { ImportDeclaration } from '../../types.js';
import type { LanguageParser } from './registry.js';

/**
 * Go import patterns:
 * - import "package"
 * - import alias "package"
 * - import (
 *     "package1"
 *     alias "package2"
 *     . "package3"
 *     _ "package4"
 *   )
 */

// Single import: import "pkg" or import alias "pkg"
const SINGLE_IMPORT_RE = /^[ \t]*import\s+(?:(\w+|\.)\s+)?["']([^"']+)["']/gm;

// Block import: import ( ... )
const BLOCK_IMPORT_RE = /^[ \t]*import\s*\(([\s\S]*?)\)/gm;

// Line inside block: optional alias + quoted path
const BLOCK_LINE_RE = /(?:(\w+|[._])\s+)?["']([^"']+)["']/g;

function lineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function parseContent(content: string): ImportDeclaration[] {
  const results: ImportDeclaration[] = [];
  const seenLines = new Set<number>();

  let match: RegExpExecArray | null;

  // Block imports first
  BLOCK_IMPORT_RE.lastIndex = 0;
  while ((match = BLOCK_IMPORT_RE.exec(content)) !== null) {
    const blockContent = match[1];
    const blockStart = match.index + content.slice(match.index).indexOf('(') + 1;

    let lineMatch: RegExpExecArray | null;
    BLOCK_LINE_RE.lastIndex = 0;
    while ((lineMatch = BLOCK_LINE_RE.exec(blockContent)) !== null) {
      const alias = lineMatch[1] || '';
      const source = lineMatch[2];
      const absoluteIndex = blockStart + lineMatch.index;
      const line = lineNumber(content, absoluteIndex);
      seenLines.add(line);

      const parts = source.split('/');
      const specifiers = alias && alias !== '_' && alias !== '.'
        ? [alias]
        : [parts[parts.length - 1]];

      results.push({
        source,
        specifiers,
        line,
        isRelative: source.startsWith('./') || source.startsWith('../'),
      });
    }
  }

  // Single imports
  SINGLE_IMPORT_RE.lastIndex = 0;
  while ((match = SINGLE_IMPORT_RE.exec(content)) !== null) {
    const line = lineNumber(content, match.index);
    if (seenLines.has(line)) continue;

    const alias = match[1] || '';
    const source = match[2];
    const parts = source.split('/');
    const specifiers = alias && alias !== '_' && alias !== '.'
      ? [alias]
      : [parts[parts.length - 1]];

    results.push({
      source,
      specifiers,
      line,
      isRelative: source.startsWith('./') || source.startsWith('../'),
    });
  }

  return results.sort((a, b) => a.line - b.line);
}

export const goParser: LanguageParser = {
  language: 'go',
  extensions: ['.go'],
  parseImports: parseContent,
};
