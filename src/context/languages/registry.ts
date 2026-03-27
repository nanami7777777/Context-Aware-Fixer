import type { SupportedLanguage, ImportDeclaration, ProjectDependency } from '../../types.js';

/** Language-specific parser for import/dependency extraction */
export interface LanguageParser {
  language: SupportedLanguage;
  extensions: string[];
  parseImports(content: string): ImportDeclaration[];
  parseProjectConfig?(configPath: string): ProjectDependency[];
}

const EXTENSION_MAP: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
};

export class LanguageRegistry {
  private parsers = new Map<SupportedLanguage, LanguageParser>();

  register(parser: LanguageParser): void {
    this.parsers.set(parser.language, parser);
  }

  getParser(language: SupportedLanguage): LanguageParser | undefined {
    return this.parsers.get(language);
  }

  detectLanguage(filePath: string): SupportedLanguage | undefined {
    const ext = extractExtension(filePath);
    return ext ? EXTENSION_MAP[ext] : undefined;
  }
}

function extractExtension(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1 || dot === filePath.length - 1) return undefined;
  return filePath.slice(dot).toLowerCase();
}
