import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitProvider, parsePorcelainBlame } from './git-provider.js';
import type { SimpleGit } from 'simple-git';

function createMockGit() {
  return {
    log: vi.fn(),
    raw: vi.fn(),
    checkIgnore: vi.fn(),
  } as unknown as SimpleGit;
}

describe('GitProvider', () => {
  let provider: GitProvider;
  let mockGit: ReturnType<typeof createMockGit>;

  beforeEach(() => {
    mockGit = createMockGit();
    provider = new GitProvider(mockGit);
  });

  describe('getFileHistory', () => {
    it('should return mapped GitCommit objects from git log', async () => {
      (mockGit.log as ReturnType<typeof vi.fn>).mockResolvedValue({
        all: [
          {
            hash: 'abc123',
            date: '2024-01-15T10:00:00Z',
            message: 'fix: resolve null pointer',
            author_name: 'Alice',
            author_email: 'alice@example.com',
            diff: {
              changed: 2,
              insertions: 5,
              deletions: 3,
              files: [{ file: 'src/foo.ts' }, { file: 'src/bar.ts' }],
            },
          },
          {
            hash: 'def456',
            date: '2024-01-14T09:00:00Z',
            message: 'feat: add feature',
            author_name: 'Bob',
            author_email: 'bob@example.com',
            diff: null,
          },
        ],
        total: 2,
        latest: null,
      });

      const result = await provider.getFileHistory('src/foo.ts', 5);

      expect(mockGit.log).toHaveBeenCalledWith(
        expect.objectContaining({ file: 'src/foo.ts', maxCount: 5 }),
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        hash: 'abc123',
        message: 'fix: resolve null pointer',
        author: 'Alice',
        date: new Date('2024-01-15T10:00:00Z'),
        filesChanged: ['src/foo.ts', 'src/bar.ts'],
        diff: '2 files changed, 5 insertions(+), 3 deletions(-)',
      });
      expect(result[1]).toEqual({
        hash: 'def456',
        message: 'feat: add feature',
        author: 'Bob',
        date: new Date('2024-01-14T09:00:00Z'),
        filesChanged: [],
        diff: undefined,
      });
    });

    it('should return empty array when no commits found', async () => {
      (mockGit.log as ReturnType<typeof vi.fn>).mockResolvedValue({
        all: [],
        total: 0,
        latest: null,
      });

      const result = await provider.getFileHistory('nonexistent.ts', 10);
      expect(result).toEqual([]);
    });
  });

  describe('getBlame', () => {
    it('should call git blame with correct line range', async () => {
      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue('');

      await provider.getBlame('src/foo.ts', 10, 20);

      expect(mockGit.raw).toHaveBeenCalledWith([
        'blame',
        '-L',
        '10,20',
        '--porcelain',
        'src/foo.ts',
      ]);
    });

    it('should parse porcelain blame output into BlameLine objects', async () => {
      const porcelainOutput = [
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 10 10 1',
        'author Alice',
        'author-mail <alice@example.com>',
        'author-time 1705312800',
        'author-tz +0000',
        'committer Alice',
        'committer-mail <alice@example.com>',
        'committer-time 1705312800',
        'committer-tz +0000',
        'summary fix bug',
        'filename src/foo.ts',
        '\tconst x = 42;',
      ].join('\n');

      (mockGit.raw as ReturnType<typeof vi.fn>).mockResolvedValue(porcelainOutput);

      const result = await provider.getBlame('src/foo.ts', 10, 10);

      expect(result).toHaveLength(1);
      expect(result[0].hash).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
      expect(result[0].author).toBe('Alice');
      expect(result[0].line).toBe(10);
      expect(result[0].content).toBe('const x = 42;');
      expect(result[0].date).toBeInstanceOf(Date);
    });
  });

  describe('isIgnored', () => {
    it('should return true when file is ignored', async () => {
      (mockGit.checkIgnore as ReturnType<typeof vi.fn>).mockResolvedValue([
        'node_modules/foo.js',
      ]);

      const result = await provider.isIgnored('node_modules/foo.js');

      expect(mockGit.checkIgnore).toHaveBeenCalledWith('node_modules/foo.js');
      expect(result).toBe(true);
    });

    it('should return false when file is not ignored', async () => {
      (mockGit.checkIgnore as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await provider.isIgnored('src/index.ts');
      expect(result).toBe(false);
    });
  });
});

describe('parsePorcelainBlame', () => {
  it('should parse multiple blame entries', () => {
    const raw = [
      'aaaa000000000000000000000000000000000000 1 1 2',
      'author Alice',
      'author-time 1700000000',
      'committer Alice',
      'committer-time 1700000000',
      'summary initial',
      'filename file.ts',
      '\tline one',
      'aaaa000000000000000000000000000000000000 2 2',
      'author Alice',
      'author-time 1700000000',
      '\tline two',
      'bbbb000000000000000000000000000000000000 3 3 1',
      'author Bob',
      'author-time 1700100000',
      'committer Bob',
      'committer-time 1700100000',
      'summary update',
      'filename file.ts',
      '\tline three',
    ].join('\n');

    const result = parsePorcelainBlame(raw);

    expect(result).toHaveLength(3);
    expect(result[0].author).toBe('Alice');
    expect(result[0].line).toBe(1);
    expect(result[0].content).toBe('line one');
    expect(result[1].line).toBe(2);
    expect(result[1].content).toBe('line two');
    expect(result[2].author).toBe('Bob');
    expect(result[2].line).toBe(3);
    expect(result[2].content).toBe('line three');
  });

  it('should return empty array for empty input', () => {
    expect(parsePorcelainBlame('')).toEqual([]);
  });

  it('should handle content with leading whitespace correctly', () => {
    const raw = [
      'cccc000000000000000000000000000000000000 5 5 1',
      'author Charlie',
      'author-time 1700200000',
      'summary indent',
      'filename file.ts',
      '\t    indented content',
    ].join('\n');

    const result = parsePorcelainBlame(raw);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('    indented content');
  });
});
