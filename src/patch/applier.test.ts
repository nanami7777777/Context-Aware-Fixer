import { describe, it, expect, vi } from 'vitest';
import {
  PatchApplier,
  type FileReader,
  type FileWriter,
  type ApplyResult,
  type ConflictInfo,
} from './applier.js';
import type { Patch, FileChange, DiffHunk } from '../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** In-memory file system for testing */
function createMemoryFS(files: Record<string, string> = {}) {
  const store = new Map(Object.entries(files));

  const reader: FileReader = {
    async readFile(filePath: string) {
      const content = store.get(filePath);
      if (content === undefined) throw new Error(`File not found: ${filePath}`);
      return content;
    },
    async exists(filePath: string) {
      return store.has(filePath);
    },
  };

  const writer: FileWriter = {
    async writeFile(filePath: string, content: string) {
      store.set(filePath, content);
    },
  };

  return { reader, writer, store };
}

function createHunk(overrides?: Partial<DiffHunk>): DiffHunk {
  return {
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 5,
    content:
      '@@ -1,3 +1,5 @@\n function processData(data: any) {\n+  if (data == null) {\n+    return undefined;\n+  }\n   return data.x;\n }',
    ...overrides,
  };
}

function createPatch(overrides?: Partial<Patch>): Patch {
  return {
    id: 'patch-1',
    description: 'Add null check',
    changes: [
      {
        filePath: 'src/app.ts',
        hunks: [createHunk()],
        explanation: 'Guard against null data',
      },
    ],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PatchApplier', () => {
  const ORIGINAL_FILE =
    'function processData(data: any) {\n  return data.x;\n}';

  const EXPECTED_AFTER_APPLY =
    'function processData(data: any) {\n  if (data == null) {\n    return undefined;\n  }\n  return data.x;\n}';

  describe('apply', () => {
    it('applies a single-hunk patch and modifies the file', async () => {
      const { reader, writer, store } = createMemoryFS({
        '/repo/src/app.ts': ORIGINAL_FILE,
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.filesModified).toEqual(['src/app.ts']);
      expect(result.linesAdded).toBe(3);
      expect(result.linesDeleted).toBe(0);
      expect(store.get('/repo/src/app.ts')).toBe(EXPECTED_AFTER_APPLY);
    });

    it('returns conflict when file does not exist', async () => {
      const { reader, writer } = createMemoryFS({});
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(false);
      expect(result.filesModified).toEqual([]);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts![0].filePath).toBe('src/app.ts');
      expect(result.conflicts![0].reason).toContain('not found');
    });

    it('returns conflict when context lines do not match', async () => {
      const { reader, writer } = createMemoryFS({
        '/repo/src/app.ts': 'function differentCode() {\n  return 42;\n}',
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts![0].reason).toContain('Context mismatch');
      expect(result.conflicts![0].suggestion).toContain('modified');
    });

    it('applies patch with deletions', async () => {
      const original = 'line1\nline2\nline3\nline4';
      const { reader, writer, store } = createMemoryFS({
        '/repo/file.ts': original,
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'file.ts',
            explanation: 'Remove line2',
            hunks: [
              {
                oldStart: 1,
                oldLines: 4,
                newStart: 1,
                newLines: 3,
                content: '@@ -1,4 +1,3 @@\n line1\n-line2\n line3\n line4',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.linesDeleted).toBe(1);
      expect(result.linesAdded).toBe(0);
      expect(store.get('/repo/file.ts')).toBe('line1\nline3\nline4');
    });

    it('applies patch with both additions and deletions', async () => {
      const original = 'const x = 1;\nconst y = 2;\nconst z = 3;';
      const { reader, writer, store } = createMemoryFS({
        '/repo/file.ts': original,
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'file.ts',
            explanation: 'Replace y with w',
            hunks: [
              {
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 3,
                content:
                  '@@ -1,3 +1,3 @@\n const x = 1;\n-const y = 2;\n+const w = 2;\n const z = 3;',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.linesAdded).toBe(1);
      expect(result.linesDeleted).toBe(1);
      expect(store.get('/repo/file.ts')).toBe(
        'const x = 1;\nconst w = 2;\nconst z = 3;',
      );
    });

    it('applies multi-file patch', async () => {
      const { reader, writer, store } = createMemoryFS({
        '/repo/a.ts': 'aaa\nbbb',
        '/repo/b.ts': 'ccc\nddd',
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'a.ts',
            explanation: 'Fix a',
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 2,
                content: '@@ -1,2 +1,2 @@\n-aaa\n+AAA\n bbb',
              },
            ],
          },
          {
            filePath: 'b.ts',
            explanation: 'Fix b',
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 2,
                content: '@@ -1,2 +1,2 @@\n ccc\n-ddd\n+DDD',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.filesModified).toEqual(['a.ts', 'b.ts']);
      expect(result.linesAdded).toBe(2);
      expect(result.linesDeleted).toBe(2);
      expect(store.get('/repo/a.ts')).toBe('AAA\nbbb');
      expect(store.get('/repo/b.ts')).toBe('ccc\nDDD');
    });

    it('reports conflict for one file while applying others', async () => {
      const { reader, writer, store } = createMemoryFS({
        '/repo/a.ts': 'aaa\nbbb',
        // b.ts is missing
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'a.ts',
            explanation: 'Fix a',
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 2,
                content: '@@ -1,2 +1,2 @@\n-aaa\n+AAA\n bbb',
              },
            ],
          },
          {
            filePath: 'b.ts',
            explanation: 'Fix b',
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                content: '@@ -1,1 +1,1 @@\n-old\n+new',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(false);
      expect(result.filesModified).toEqual(['a.ts']);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts![0].filePath).toBe('b.ts');
    });

    it('detects conflict when file is shorter than expected', async () => {
      const { reader, writer } = createMemoryFS({
        '/repo/short.ts': 'only one line',
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'short.ts',
            explanation: 'Fix',
            hunks: [
              {
                oldStart: 1,
                oldLines: 3,
                newStart: 1,
                newLines: 3,
                content:
                  '@@ -1,3 +1,3 @@\n only one line\n second line\n third line',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(false);
      expect(result.conflicts![0].reason).toContain('Unexpected end of file');
    });

    it('does not include conflicts key when there are none', async () => {
      const { reader, writer } = createMemoryFS({
        '/repo/src/app.ts': ORIGINAL_FILE,
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.apply(patch, '/repo');

      expect(result.conflicts).toBeUndefined();
    });
  });

  describe('preview', () => {
    it('computes changes without modifying files', async () => {
      const { reader, writer, store } = createMemoryFS({
        '/repo/src/app.ts': ORIGINAL_FILE,
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.preview(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.filesModified).toEqual(['src/app.ts']);
      expect(result.linesAdded).toBe(3);
      expect(result.linesDeleted).toBe(0);
      // File should NOT be modified
      expect(store.get('/repo/src/app.ts')).toBe(ORIGINAL_FILE);
    });

    it('detects conflicts in preview mode', async () => {
      const { reader, writer } = createMemoryFS({
        '/repo/src/app.ts': 'completely different content',
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.preview(patch, '/repo');

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
    });

    it('reports file-not-found conflicts in preview mode', async () => {
      const { reader, writer } = createMemoryFS({});
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch();

      const result = await applier.preview(patch, '/repo');

      expect(result.success).toBe(false);
      expect(result.conflicts![0].reason).toContain('not found');
    });

    it('returns correct stats for multi-file preview', async () => {
      const { reader, writer } = createMemoryFS({
        '/repo/a.ts': 'aaa\nbbb',
        '/repo/b.ts': 'ccc\nddd',
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'a.ts',
            explanation: 'Fix a',
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 2,
                content: '@@ -1,2 +1,2 @@\n-aaa\n+AAA\n bbb',
              },
            ],
          },
          {
            filePath: 'b.ts',
            explanation: 'Fix b',
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 3,
                content: '@@ -1,2 +1,3 @@\n ccc\n+eee\n ddd',
              },
            ],
          },
        ],
      });

      const result = await applier.preview(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.filesModified).toEqual(['a.ts', 'b.ts']);
      expect(result.linesAdded).toBe(2);
      expect(result.linesDeleted).toBe(1);
    });
  });

  describe('multi-hunk patches', () => {
    it('applies multiple hunks to the same file with correct offset tracking', async () => {
      const original = 'line1\nline2\nline3\nline4\nline5\nline6';
      const { reader, writer, store } = createMemoryFS({
        '/repo/file.ts': original,
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'file.ts',
            explanation: 'Multi-hunk fix',
            hunks: [
              {
                oldStart: 1,
                oldLines: 2,
                newStart: 1,
                newLines: 3,
                content: '@@ -1,2 +1,3 @@\n line1\n+inserted\n line2',
              },
              {
                oldStart: 5,
                oldLines: 2,
                newStart: 6,
                newLines: 2,
                content: '@@ -5,2 +6,2 @@\n-line5\n+LINE5\n line6',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(true);
      expect(store.get('/repo/file.ts')).toBe(
        'line1\ninserted\nline2\nline3\nline4\nLINE5\nline6',
      );
      expect(result.linesAdded).toBe(2);
      expect(result.linesDeleted).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles empty patch with no changes', async () => {
      const { reader, writer } = createMemoryFS({});
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({ changes: [] });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(true);
      expect(result.filesModified).toEqual([]);
      expect(result.linesAdded).toBe(0);
      expect(result.linesDeleted).toBe(0);
    });

    it('conflict suggestion recommends re-running analysis', async () => {
      const { reader, writer } = createMemoryFS({
        '/repo/file.ts': 'different content',
      });
      const applier = new PatchApplier(reader, writer);
      const patch = createPatch({
        changes: [
          {
            filePath: 'file.ts',
            explanation: 'Fix',
            hunks: [
              {
                oldStart: 1,
                oldLines: 1,
                newStart: 1,
                newLines: 1,
                content: '@@ -1,1 +1,1 @@\n-expected content\n+new content',
              },
            ],
          },
        ],
      });

      const result = await applier.apply(patch, '/repo');

      expect(result.success).toBe(false);
      const conflict = result.conflicts![0];
      expect(conflict.suggestion).toBeTruthy();
      expect(typeof conflict.suggestion).toBe('string');
    });
  });
});
