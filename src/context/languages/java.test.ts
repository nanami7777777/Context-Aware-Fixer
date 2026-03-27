import { describe, it, expect } from 'vitest';
import { javaParser } from './java.js';

describe('Java Parser', () => {
  it('parses single class import', () => {
    const result = javaParser.parseImports(`import java.util.HashMap;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('java.util.HashMap');
    expect(result[0].specifiers).toEqual(['HashMap']);
    expect(result[0].isRelative).toBe(false);
  });

  it('parses wildcard import', () => {
    const result = javaParser.parseImports(`import java.util.*;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('java.util.*');
    expect(result[0].specifiers).toEqual(['*']);
  });

  it('parses static import', () => {
    const result = javaParser.parseImports(`import static org.junit.Assert.assertEquals;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('org.junit.Assert.assertEquals');
    expect(result[0].specifiers).toEqual(['assertEquals']);
  });

  it('parses multiple imports', () => {
    const content = `
import java.util.List;
import java.util.Map;
import com.example.MyClass;
`;
    const result = javaParser.parseImports(content);
    expect(result).toHaveLength(3);
    expect(result[0].source).toBe('java.util.List');
    expect(result[1].source).toBe('java.util.Map');
    expect(result[2].source).toBe('com.example.MyClass');
  });

  it('preserves line numbers', () => {
    const content = `package com.example;

import java.util.List;
import java.util.Map;`;
    const result = javaParser.parseImports(content);
    expect(result[0].line).toBe(3);
    expect(result[1].line).toBe(4);
  });

  it('returns empty array for no imports', () => {
    expect(javaParser.parseImports(`public class Main {}`)).toEqual([]);
  });

  it('handles empty content', () => {
    expect(javaParser.parseImports('')).toEqual([]);
  });
});
