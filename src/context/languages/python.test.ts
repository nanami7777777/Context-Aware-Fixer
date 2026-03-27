import { describe, it, expect } from 'vitest';
import { pythonParser } from './python.js';

describe('Python Parser', () => {
  describe('from ... import ...', () => {
    it('parses from-import with single name', () => {
      const result = pythonParser.parseImports(`from os import path`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('os');
      expect(result[0].specifiers).toEqual(['path']);
      expect(result[0].isRelative).toBe(false);
    });

    it('parses from-import with multiple names', () => {
      const result = pythonParser.parseImports(`from os.path import join, dirname, exists`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('os.path');
      expect(result[0].specifiers).toEqual(['join', 'dirname', 'exists']);
    });

    it('parses from-import with alias', () => {
      const result = pythonParser.parseImports(`from datetime import datetime as dt`);
      expect(result).toHaveLength(1);
      expect(result[0].specifiers).toEqual(['dt']);
    });

    it('parses relative import (dot)', () => {
      const result = pythonParser.parseImports(`from . import utils`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('.');
      expect(result[0].isRelative).toBe(true);
    });

    it('parses relative import (double dot)', () => {
      const result = pythonParser.parseImports(`from ..models import User`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('..models');
      expect(result[0].isRelative).toBe(true);
    });

    it('parses wildcard import', () => {
      const result = pythonParser.parseImports(`from module import *`);
      expect(result).toHaveLength(1);
      expect(result[0].specifiers).toEqual(['*']);
    });
  });

  describe('plain import', () => {
    it('parses simple import', () => {
      const result = pythonParser.parseImports(`import os`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('os');
      expect(result[0].specifiers).toEqual([]);
    });

    it('parses import with alias', () => {
      const result = pythonParser.parseImports(`import numpy as np`);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('numpy');
    });

    it('parses multiple comma-separated imports', () => {
      const result = pythonParser.parseImports(`import os, sys, json`);
      expect(result).toHaveLength(3);
      expect(result.map(r => r.source)).toEqual(['os', 'sys', 'json']);
    });
  });

  describe('multiple imports', () => {
    it('parses mixed import styles', () => {
      const content = `
import os
from pathlib import Path
import sys
from typing import List, Dict
`;
      const result = pythonParser.parseImports(content);
      expect(result).toHaveLength(4);
      expect(result[0].source).toBe('os');
      expect(result[1].source).toBe('pathlib');
      expect(result[2].source).toBe('sys');
      expect(result[3].source).toBe('typing');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for no imports', () => {
      expect(pythonParser.parseImports(`x = 42\nprint(x)`)).toEqual([]);
    });

    it('handles empty content', () => {
      expect(pythonParser.parseImports('')).toEqual([]);
    });
  });
});
