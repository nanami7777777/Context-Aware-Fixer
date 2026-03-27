import { describe, it, expect, beforeEach } from 'vitest';
import { ASTParser } from './ast-parser.js';
import { LanguageRegistry } from './languages/registry.js';
import { typescriptParser, javascriptParser } from './languages/typescript.js';
import { pythonParser } from './languages/python.js';
import { javaParser } from './languages/java.js';
import { goParser } from './languages/go.js';
import { rustParser } from './languages/rust.js';

describe('ASTParser', () => {
  let registry: LanguageRegistry;
  let parser: ASTParser;

  beforeEach(() => {
    registry = new LanguageRegistry();
    registry.register(typescriptParser);
    registry.register(javascriptParser);
    registry.register(pythonParser);
    registry.register(javaParser);
    registry.register(goParser);
    registry.register(rustParser);
    parser = new ASTParser(registry);
  });

  describe('parse', () => {
    it('returns ASTInfo with detected language and imports for TypeScript', () => {
      const content = `import { foo } from './foo';\nimport bar from 'bar';\n`;
      const info = parser.parse('src/index.ts', content);

      expect(info).toBeDefined();
      expect(info!.language).toBe('typescript');
      expect(info!.imports).toHaveLength(2);
      expect(info!.imports[0].source).toBe('./foo');
      expect(info!.imports[1].source).toBe('bar');
    });

    it('returns ASTInfo for Python files', () => {
      const content = `import os\nfrom pathlib import Path\n`;
      const info = parser.parse('main.py', content);

      expect(info).toBeDefined();
      expect(info!.language).toBe('python');
      expect(info!.imports.length).toBeGreaterThanOrEqual(2);
    });

    it('returns ASTInfo for Java files', () => {
      const content = `import java.util.List;\nimport java.io.File;\n`;
      const info = parser.parse('Main.java', content);

      expect(info).toBeDefined();
      expect(info!.language).toBe('java');
      expect(info!.imports).toHaveLength(2);
    });

    it('returns ASTInfo for Go files', () => {
      const content = `package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n`;
      const info = parser.parse('main.go', content);

      expect(info).toBeDefined();
      expect(info!.language).toBe('go');
      expect(info!.imports.length).toBeGreaterThanOrEqual(2);
    });

    it('returns ASTInfo for Rust files', () => {
      const content = `use std::io;\nuse std::collections::HashMap;\n`;
      const info = parser.parse('lib.rs', content);

      expect(info).toBeDefined();
      expect(info!.language).toBe('rust');
      expect(info!.imports).toHaveLength(2);
    });

    it('returns undefined for unsupported file types', () => {
      const info = parser.parse('README.md', '# Hello');
      expect(info).toBeUndefined();
    });

    it('returns empty arrays for exports, functions, and classes', () => {
      const info = parser.parse('index.ts', `import { x } from 'y';`);
      expect(info).toBeDefined();
      expect(info!.exports).toEqual([]);
      expect(info!.functions).toEqual([]);
      expect(info!.classes).toEqual([]);
    });

    it('handles files with no imports', () => {
      const info = parser.parse('empty.ts', 'const x = 1;\n');
      expect(info).toBeDefined();
      expect(info!.language).toBe('typescript');
      expect(info!.imports).toEqual([]);
    });
  });

  describe('extractImports', () => {
    it('extracts TypeScript ES imports', () => {
      const content = `import { a, b } from './utils';\nimport c from 'lodash';\n`;
      const imports = parser.extractImports('file.ts', content);

      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('./utils');
      expect(imports[0].isRelative).toBe(true);
      expect(imports[1].source).toBe('lodash');
      expect(imports[1].isRelative).toBe(false);
    });

    it('extracts JavaScript require calls', () => {
      const content = `const fs = require('fs');\nconst path = require('path');\n`;
      const imports = parser.extractImports('file.js', content);

      expect(imports).toHaveLength(2);
      expect(imports[0].source).toBe('fs');
      expect(imports[1].source).toBe('path');
    });

    it('extracts Python imports', () => {
      const content = `import os\nfrom collections import OrderedDict\n`;
      const imports = parser.extractImports('app.py', content);

      expect(imports.length).toBeGreaterThanOrEqual(2);
      expect(imports.some(i => i.source === 'os')).toBe(true);
      expect(imports.some(i => i.source === 'collections')).toBe(true);
    });

    it('returns empty array for unsupported file types', () => {
      const imports = parser.extractImports('data.csv', 'a,b,c');
      expect(imports).toEqual([]);
    });

    it('returns empty array when language is detected but no parser registered', () => {
      const emptyRegistry = new LanguageRegistry();
      const sparseParser = new ASTParser(emptyRegistry);
      // Registry can detect language but has no parser registered
      const imports = sparseParser.extractImports('file.ts', `import x from 'y';`);
      expect(imports).toEqual([]);
    });
  });
});
