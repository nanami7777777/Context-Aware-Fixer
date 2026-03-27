import { describe, it, expect } from 'vitest';
import { goParser } from './go.js';

describe('Go Parser', () => {
  it('parses single import', () => {
    const result = goParser.parseImports(`import "fmt"`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('fmt');
    expect(result[0].specifiers).toEqual(['fmt']);
    expect(result[0].isRelative).toBe(false);
  });

  it('parses aliased import', () => {
    const result = goParser.parseImports(`import myfmt "fmt"`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('fmt');
    expect(result[0].specifiers).toEqual(['myfmt']);
  });

  it('parses block imports', () => {
    const content = `import (
	"fmt"
	"os"
	"strings"
)`;
    const result = goParser.parseImports(content);
    expect(result).toHaveLength(3);
    expect(result.map(r => r.source)).toEqual(['fmt', 'os', 'strings']);
  });

  it('parses block imports with aliases', () => {
    const content = `import (
	"fmt"
	log "github.com/sirupsen/logrus"
)`;
    const result = goParser.parseImports(content);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('fmt');
    expect(result[1].source).toBe('github.com/sirupsen/logrus');
    expect(result[1].specifiers).toEqual(['log']);
  });

  it('parses full package paths', () => {
    const result = goParser.parseImports(`import "github.com/gin-gonic/gin"`);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('github.com/gin-gonic/gin');
    expect(result[0].specifiers).toEqual(['gin']);
  });

  it('preserves line numbers in block imports', () => {
    const content = `package main

import (
	"fmt"
	"os"
)`;
    const result = goParser.parseImports(content);
    expect(result[0].line).toBe(4);
    expect(result[1].line).toBe(5);
  });

  it('returns empty array for no imports', () => {
    expect(goParser.parseImports(`package main\n\nfunc main() {}`)).toEqual([]);
  });

  it('handles empty content', () => {
    expect(goParser.parseImports('')).toEqual([]);
  });
});
