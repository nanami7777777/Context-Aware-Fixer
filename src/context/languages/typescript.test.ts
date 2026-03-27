import { describe, it, expect } from 'vitest';
import { typescriptParser, javascriptParser } from './typescript.js';

describe('TypeScript/JavaScript Parser', () => {
  describe('ES module imports', () => {
    it('parses named imports', () => {
      const result = typescriptParser.parseImports(`import { foo, bar } from './utils';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./utils');
      expect(result[0].specifiers).toEqual(['foo', 'bar']);
      expect(result[0].isRelative).toBe(true);
      expect(result[0].line).toBe(1);
    });

    it('parses default import', () => {
      const result = typescriptParser.parseImports(`import React from 'react';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('react');
      expect(result[0].specifiers).toEqual(['React']);
      expect(result[0].isRelative).toBe(false);
    });

    it('parses namespace import', () => {
      const result = typescriptParser.parseImports(`import * as path from 'path';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('path');
      expect(result[0].specifiers).toEqual(['path']);
    });

    it('parses type imports', () => {
      const result = typescriptParser.parseImports(`import type { Foo } from './types';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./types');
      expect(result[0].specifiers).toEqual(['Foo']);
    });

    it('parses side-effect import', () => {
      const result = typescriptParser.parseImports(`import './polyfill';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./polyfill');
      expect(result[0].specifiers).toEqual([]);
    });

    it('parses default + named imports', () => {
      const result = typescriptParser.parseImports(`import React, { useState } from 'react';`);
      expect(result).toHaveLength(1);
      expect(result[0].specifiers).toContain('React');
      expect(result[0].specifiers).toContain('useState');
    });
  });

  describe('CommonJS require', () => {
    it('parses require call', () => {
      const result = javascriptParser.parseImports(`const fs = require('fs');`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('fs');
      expect(result[0].isRelative).toBe(false);
    });

    it('parses relative require', () => {
      const result = javascriptParser.parseImports(`const utils = require('./utils');`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./utils');
      expect(result[0].isRelative).toBe(true);
    });
  });

  describe('Re-exports', () => {
    it('parses named re-export', () => {
      const result = typescriptParser.parseImports(`export { foo, bar } from './module';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./module');
    });

    it('parses wildcard re-export', () => {
      const result = typescriptParser.parseImports(`export * from './module';`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('./module');
    });
  });

  describe('multiple imports', () => {
    it('parses multiple import statements', () => {
      const content = `
import { readFile } from 'fs/promises';
import path from 'path';
import { helper } from './helper';
const chalk = require('chalk');
`;
      const result = typescriptParser.parseImports(content);
      expect(result).toHaveLength(4);
      expect(result.map(r => r.source)).toEqual([
        'fs/promises', 'path', './helper', 'chalk'
      ]);
    });

    it('preserves line numbers', () => {
      const content = `import a from 'a';
import b from 'b';
import c from 'c';`;
      const result = typescriptParser.parseImports(content);
      expect(result[0].line).toBe(1);
      expect(result[1].line).toBe(2);
      expect(result[2].line).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for content with no imports', () => {
      const result = typescriptParser.parseImports(`const x = 42;\nconsole.log(x);`);
      expect(result).toEqual([]);
    });

    it('handles empty content', () => {
      const result = typescriptParser.parseImports('');
      expect(result).toEqual([]);
    });
  });
});
