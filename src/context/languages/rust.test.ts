import { describe, it, expect } from 'vitest';
import { rustParser } from './rust.js';

describe('Rust Parser', () => {
  it('parses simple use statement', () => {
    const result = rustParser.parseImports(`use std::collections::HashMap;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('std::collections');
    expect(result[0].specifiers).toEqual(['HashMap']);
    expect(result[0].isRelative).toBe(false);
  });

  it('parses grouped use statement', () => {
    const result = rustParser.parseImports(`use std::collections::{HashMap, BTreeMap};`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('std::collections');
    expect(result[0].specifiers).toEqual(['HashMap', 'BTreeMap']);
  });

  it('parses wildcard use', () => {
    const result = rustParser.parseImports(`use std::io::*;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('std::io');
    expect(result[0].specifiers).toEqual(['*']);
  });

  it('parses crate-relative use (isRelative)', () => {
    const result = rustParser.parseImports(`use crate::models::User;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('crate::models');
    expect(result[0].specifiers).toEqual(['User']);
    expect(result[0].isRelative).toBe(true);
  });

  it('parses super-relative use', () => {
    const result = rustParser.parseImports(`use super::utils;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('super');
    expect(result[0].specifiers).toEqual(['utils']);
    expect(result[0].isRelative).toBe(true);
  });

  it('parses self-relative use', () => {
    const result = rustParser.parseImports(`use self::config::Settings;`);
    expect(result).toHaveLength(1);
    expect(result[0].isRelative).toBe(true);
  });

  it('parses pub use', () => {
    const result = rustParser.parseImports(`pub use crate::error::Error;`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('crate::error');
    expect(result[0].specifiers).toEqual(['Error']);
  });

  it('parses use with alias', () => {
    const result = rustParser.parseImports(`use std::io::Result as IoResult;`);
    expect(result).toHaveLength(1);
    expect(result[0].specifiers).toEqual(['IoResult']);
  });

  it('parses multiple use statements', () => {
    const content = `
use std::io;
use std::collections::HashMap;
use crate::models::{User, Post};
`;
    const result = rustParser.parseImports(content);
    expect(result).toHaveLength(3);
    expect(result[0].source).toBe('std');
    expect(result[1].source).toBe('std::collections');
    expect(result[2].source).toBe('crate::models');
  });

  it('returns empty array for no use statements', () => {
    expect(rustParser.parseImports(`fn main() { println!("hello"); }`)).toEqual([]);
  });

  it('handles empty content', () => {
    expect(rustParser.parseImports('')).toEqual([]);
  });
});
