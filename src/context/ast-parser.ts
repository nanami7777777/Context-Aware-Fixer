import type { SupportedLanguage, ImportDeclaration } from '../types.js';
import { LanguageRegistry } from './languages/registry.js';

/** Basic AST information extracted from a source file */
export interface ASTInfo {
  language: SupportedLanguage;
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  functions: FunctionDeclaration[];
  classes: ClassDeclaration[];
}

export interface ExportDeclaration {
  name: string;
  line: number;
}

export interface FunctionDeclaration {
  name: string;
  line: number;
}

export interface ClassDeclaration {
  name: string;
  line: number;
}

/**
 * Lightweight AST parser that delegates to the LanguageRegistry
 * for language detection and import extraction.
 *
 * Acts as a facade — no native tree-sitter bindings required.
 */
export class ASTParser {
  constructor(private registry: LanguageRegistry) {}

  /**
   * Parse a file and return basic structural information.
   * Returns `undefined` when the language is unsupported.
   */
  parse(filePath: string, content: string): ASTInfo | undefined {
    const language = this.registry.detectLanguage(filePath);
    if (!language) return undefined;

    const imports = this.extractImports(filePath, content);

    return {
      language,
      imports,
      exports: [],
      functions: [],
      classes: [],
    };
  }

  /**
   * Extract import / dependency declarations from a source file.
   * Delegates to the registered language parser for the detected language.
   */
  extractImports(filePath: string, content: string): ImportDeclaration[] {
    const language = this.registry.detectLanguage(filePath);
    if (!language) return [];

    const parser = this.registry.getParser(language);
    if (!parser) return [];

    return parser.parseImports(content);
  }
}
