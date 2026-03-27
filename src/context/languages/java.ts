import type { ImportDeclaration } from '../../types.js';
import type { LanguageParser } from './registry.js';

/**
 * Java import patterns:
 * - import package.Class;
 * - import package.*;
 * - import static package.Class.method;
 */

const JAVA_IMPORT_RE = /^[ \t]*import\s+(static\s+)?([a-zA-Z_][\w.]*(?:\.\*)?)\s*;/gm;

function lineNumber(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function parseContent(content: string): ImportDeclaration[] {
  const results: ImportDeclaration[] = [];

  let match: RegExpExecArray | null;
  JAVA_IMPORT_RE.lastIndex = 0;
  while ((match = JAVA_IMPORT_RE.exec(content)) !== null) {
    const fullPath = match[2];
    const parts = fullPath.split('.');
    const lastPart = parts[parts.length - 1];
    const specifiers = lastPart === '*' ? ['*'] : [lastPart];

    results.push({
      source: fullPath,
      specifiers,
      line: lineNumber(content, match.index),
      isRelative: false, // Java imports are always absolute package paths
    });
  }

  return results;
}

export const javaParser: LanguageParser = {
  language: 'java',
  extensions: ['.java'],
  parseImports: parseContent,
};
