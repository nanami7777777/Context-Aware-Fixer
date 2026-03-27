import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyResolver } from './dependency-resolver.js';
import { ASTParser } from './ast-parser.js';
import { LanguageRegistry } from './languages/registry.js';
import { typescriptParser, javascriptParser } from './languages/typescript.js';
import { pythonParser } from './languages/python.js';

describe('DependencyResolver', () => {
  let registry: LanguageRegistry;
  let astParser: ASTParser;
  let resolver: DependencyResolver;
  const repoRoot = '/repo';

  beforeEach(() => {
    registry = new LanguageRegistry();
    registry.register(typescriptParser);
    registry.register(javascriptParser);
    registry.register(pythonParser);
    astParser = new ASTParser(registry);
    resolver = new DependencyResolver(astParser, repoRoot);
  });

  describe('buildGraph', () => {
    it('builds a graph from TypeScript files with relative imports', () => {
      const files = new Map<string, string>([
        ['/repo/src/index.ts', `import { foo } from './utils';\n`],
        ['/repo/src/utils.ts', `export const foo = 1;\n`],
      ]);

      resolver.buildGraph(files);

      const graph = resolver.getGraph();
      expect(graph.size).toBe(2);
      expect(graph.has('/repo/src/index.ts')).toBe(true);
      expect(graph.has('/repo/src/utils.ts')).toBe(true);
    });

    it('resolves relative imports to known files', () => {
      const files = new Map<string, string>([
        ['/repo/src/index.ts', `import { helper } from './lib/helper';\n`],
        ['/repo/src/lib/helper.ts', `export function helper() {}\n`],
      ]);

      resolver.buildGraph(files);

      const deps = resolver.getDependencies('/repo/src/index.ts');
      expect(deps).toContain('/repo/src/lib/helper.ts');
    });

    it('ignores non-relative (package) imports', () => {
      const files = new Map<string, string>([
        ['/repo/src/app.ts', `import express from 'express';\nimport { foo } from './foo';\n`],
        ['/repo/src/foo.ts', `export const foo = 1;\n`],
      ]);

      resolver.buildGraph(files);

      const deps = resolver.getDependencies('/repo/src/app.ts');
      // Only the relative import should be tracked
      expect(deps).toHaveLength(1);
      expect(deps[0]).toContain('foo');
    });

    it('ignores relative imports to files not in the known set', () => {
      const files = new Map<string, string>([
        ['/repo/src/index.ts', `import { missing } from './missing';\n`],
      ]);

      resolver.buildGraph(files);

      const deps = resolver.getDependencies('/repo/src/index.ts');
      expect(deps).toHaveLength(0);
    });

    it('handles .js extension stripping for TS projects', () => {
      const files = new Map<string, string>([
        ['/repo/src/main.ts', `import { util } from './util.js';\n`],
        ['/repo/src/util.ts', `export const util = 1;\n`],
      ]);

      resolver.buildGraph(files);

      const deps = resolver.getDependencies('/repo/src/main.ts');
      expect(deps).toContain('/repo/src/util.ts');
    });

    it('clears previous graph on rebuild', () => {
      const files1 = new Map<string, string>([
        ['/repo/a.ts', `const x = 1;\n`],
      ]);
      resolver.buildGraph(files1);
      expect(resolver.getGraph().size).toBe(1);

      const files2 = new Map<string, string>([
        ['/repo/b.ts', `const y = 2;\n`],
        ['/repo/c.ts', `const z = 3;\n`],
      ]);
      resolver.buildGraph(files2);
      expect(resolver.getGraph().size).toBe(2);
      expect(resolver.getGraph().has('/repo/a.ts')).toBe(false);
    });
  });

  describe('getDependencies', () => {
    it('returns empty array for unknown files', () => {
      expect(resolver.getDependencies('/repo/unknown.ts')).toEqual([]);
    });

    it('returns empty array for files with no relative imports', () => {
      const files = new Map<string, string>([
        ['/repo/src/standalone.ts', `import lodash from 'lodash';\n`],
      ]);
      resolver.buildGraph(files);
      expect(resolver.getDependencies('/repo/src/standalone.ts')).toEqual([]);
    });
  });

  describe('getTransitiveDependencies', () => {
    it('returns transitive dependencies with correct depths', () => {
      // a -> b -> c
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `import { b } from './b';\n`],
        ['/repo/src/b.ts', `import { c } from './c';\n`],
        ['/repo/src/c.ts', `export const c = 1;\n`],
      ]);

      resolver.buildGraph(files);

      const transitive = resolver.getTransitiveDependencies('/repo/src/a.ts');
      expect(transitive).toHaveLength(2);

      const bDep = transitive.find(d => d.filePath === '/repo/src/b.ts');
      const cDep = transitive.find(d => d.filePath === '/repo/src/c.ts');
      expect(bDep?.depth).toBe(1);
      expect(cDep?.depth).toBe(2);
    });

    it('respects maxDepth parameter', () => {
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `import { b } from './b';\n`],
        ['/repo/src/b.ts', `import { c } from './c';\n`],
        ['/repo/src/c.ts', `export const c = 1;\n`],
      ]);

      resolver.buildGraph(files);

      const transitive = resolver.getTransitiveDependencies('/repo/src/a.ts', 1);
      expect(transitive).toHaveLength(1);
      expect(transitive[0].filePath).toBe('/repo/src/b.ts');
    });

    it('handles circular dependencies without infinite loops', () => {
      // a -> b -> a (circular)
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `import { b } from './b';\n`],
        ['/repo/src/b.ts', `import { a } from './a';\n`],
      ]);

      resolver.buildGraph(files);

      // Should not hang
      const transitive = resolver.getTransitiveDependencies('/repo/src/a.ts');
      expect(transitive).toHaveLength(1);
      expect(transitive[0].filePath).toBe('/repo/src/b.ts');
    });

    it('returns empty array when file has no dependencies', () => {
      const files = new Map<string, string>([
        ['/repo/src/leaf.ts', `export const x = 1;\n`],
      ]);
      resolver.buildGraph(files);

      const transitive = resolver.getTransitiveDependencies('/repo/src/leaf.ts');
      expect(transitive).toHaveLength(0);
    });
  });

  describe('getImportDepth', () => {
    it('returns 0 for same file', () => {
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `const x = 1;\n`],
      ]);
      resolver.buildGraph(files);

      expect(resolver.getImportDepth('/repo/src/a.ts', '/repo/src/a.ts')).toBe(0);
    });

    it('returns 1 for direct dependency', () => {
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `import { b } from './b';\n`],
        ['/repo/src/b.ts', `export const b = 1;\n`],
      ]);
      resolver.buildGraph(files);

      expect(resolver.getImportDepth('/repo/src/a.ts', '/repo/src/b.ts')).toBe(1);
    });

    it('returns correct depth for transitive dependency', () => {
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `import { b } from './b';\n`],
        ['/repo/src/b.ts', `import { c } from './c';\n`],
        ['/repo/src/c.ts', `export const c = 1;\n`],
      ]);
      resolver.buildGraph(files);

      expect(resolver.getImportDepth('/repo/src/a.ts', '/repo/src/c.ts')).toBe(2);
    });

    it('returns -1 for unreachable file', () => {
      const files = new Map<string, string>([
        ['/repo/src/a.ts', `const x = 1;\n`],
        ['/repo/src/b.ts', `const y = 2;\n`],
      ]);
      resolver.buildGraph(files);

      expect(resolver.getImportDepth('/repo/src/a.ts', '/repo/src/b.ts')).toBe(-1);
    });

    it('returns -1 for unknown root file', () => {
      expect(resolver.getImportDepth('/repo/unknown.ts', '/repo/other.ts')).toBe(-1);
    });
  });

  describe('cross-language dependencies', () => {
    it('builds graph with mixed TypeScript and Python files', () => {
      const files = new Map<string, string>([
        ['/repo/src/main.ts', `import { api } from './api';\n`],
        ['/repo/src/api.ts', `export const api = {};\n`],
        ['/repo/scripts/run.py', `from utils import helper\n`],
        ['/repo/scripts/utils.py', `def helper(): pass\n`],
      ]);

      resolver.buildGraph(files);

      const graph = resolver.getGraph();
      expect(graph.size).toBe(4);

      // TS dependencies
      const tsDeps = resolver.getDependencies('/repo/src/main.ts');
      expect(tsDeps).toContain('/repo/src/api.ts');

      // Python relative imports are not flagged as isRelative by the parser
      // (Python uses module-style imports), so they won't appear as file deps
      const pyDeps = resolver.getDependencies('/repo/scripts/run.py');
      expect(pyDeps).toEqual([]);
    });
  });
});
