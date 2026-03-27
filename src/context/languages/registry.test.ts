import { describe, it, expect, beforeEach } from 'vitest';
import { LanguageRegistry } from './registry.js';
import { typescriptParser, javascriptParser } from './typescript.js';
import { pythonParser } from './python.js';
import { javaParser } from './java.js';
import { goParser } from './go.js';
import { rustParser } from './rust.js';

describe('LanguageRegistry', () => {
  let registry: LanguageRegistry;

  beforeEach(() => {
    registry = new LanguageRegistry();
  });

  it('registers and retrieves a parser', () => {
    registry.register(typescriptParser);
    expect(registry.getParser('typescript')).toBe(typescriptParser);
  });

  it('returns undefined for unregistered language', () => {
    expect(registry.getParser('python')).toBeUndefined();
  });

  it('detects TypeScript from .ts extension', () => {
    expect(registry.detectLanguage('src/index.ts')).toBe('typescript');
  });

  it('detects TypeScript from .tsx extension', () => {
    expect(registry.detectLanguage('App.tsx')).toBe('typescript');
  });

  it('detects JavaScript from .js extension', () => {
    expect(registry.detectLanguage('lib/utils.js')).toBe('javascript');
  });

  it('detects JavaScript from .mjs extension', () => {
    expect(registry.detectLanguage('config.mjs')).toBe('javascript');
  });

  it('detects Python from .py extension', () => {
    expect(registry.detectLanguage('main.py')).toBe('python');
  });

  it('detects Java from .java extension', () => {
    expect(registry.detectLanguage('Main.java')).toBe('java');
  });

  it('detects Go from .go extension', () => {
    expect(registry.detectLanguage('main.go')).toBe('go');
  });

  it('detects Rust from .rs extension', () => {
    expect(registry.detectLanguage('lib.rs')).toBe('rust');
  });

  it('returns undefined for unknown extension', () => {
    expect(registry.detectLanguage('readme.md')).toBeUndefined();
  });

  it('returns undefined for file with no extension', () => {
    expect(registry.detectLanguage('Makefile')).toBeUndefined();
  });

  it('is case-insensitive for extensions', () => {
    expect(registry.detectLanguage('Main.JAVA')).toBe('java');
  });
});
