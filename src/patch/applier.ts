import * as path from 'node:path';
import type { Patch, FileChange, DiffHunk } from '../types.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Abstraction for reading files (dependency injection for testability) */
export interface FileReader {
  readFile(filePath: string): Promise<string>;
  exists(filePath: string): Promise<boolean>;
}

/** Abstraction for writing files (dependency injection for testability) */
export interface FileWriter {
  writeFile(filePath: string, content: string): Promise<void>;
}

/** Result of applying a patch */
export interface ApplyResult {
  success: boolean;
  filesModified: string[];
  linesAdded: number;
  linesDeleted: number;
  conflicts?: ConflictInfo[];
}

/** Result of previewing a patch (same shape as ApplyResult) */
export type PreviewResult = ApplyResult;

/** Information about a conflict encountered during patch application */
export interface ConflictInfo {
  filePath: string;
  reason: string;
  suggestion: string;
}

// ─── Hunk Parsing ────────────────────────────────────────────────────────────

interface ParsedLine {
  type: 'context' | 'add' | 'delete';
  content: string;
}

function parseHunkLines(hunk: DiffHunk): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const raw = hunk.content;

  // Split content into lines, skip the @@ header if present
  const allLines = raw.split('\n');
  for (const line of allLines) {
    if (line.startsWith('@@') || line === '') continue;
    if (line.startsWith('+')) {
      lines.push({ type: 'add', content: line.slice(1) });
    } else if (line.startsWith('-')) {
      lines.push({ type: 'delete', content: line.slice(1) });
    } else if (line.startsWith(' ')) {
      lines.push({ type: 'context', content: line.slice(1) });
    } else {
      // Treat lines without prefix as context
      lines.push({ type: 'context', content: line });
    }
  }
  return lines;
}

// ─── PatchApplier ────────────────────────────────────────────────────────────

export class PatchApplier {
  private readonly reader: FileReader;
  private readonly writer: FileWriter;

  constructor(reader: FileReader, writer: FileWriter) {
    this.reader = reader;
    this.writer = writer;
  }

  /**
   * Apply a patch to the file system.
   * Reads target files, applies hunks, writes modified files back.
   */
  async apply(patch: Patch, repoPath: string): Promise<ApplyResult> {
    return this.applyInternal(patch, repoPath, false);
  }

  /**
   * Preview a patch (dry-run). Computes changes but does not write files.
   */
  async preview(patch: Patch, repoPath: string): Promise<PreviewResult> {
    return this.applyInternal(patch, repoPath, true);
  }

  private async applyInternal(
    patch: Patch,
    repoPath: string,
    dryRun: boolean,
  ): Promise<ApplyResult> {
    const filesModified: string[] = [];
    const conflicts: ConflictInfo[] = [];
    let totalAdded = 0;
    let totalDeleted = 0;

    for (const change of patch.changes) {
      const fullPath = path.resolve(repoPath, change.filePath);
      const result = await this.applyFileChange(change, fullPath, dryRun);

      if (result.conflict) {
        conflicts.push(result.conflict);
      } else {
        filesModified.push(change.filePath);
        totalAdded += result.linesAdded;
        totalDeleted += result.linesDeleted;
      }
    }

    const hasConflicts = conflicts.length > 0;

    return {
      success: !hasConflicts,
      filesModified,
      linesAdded: totalAdded,
      linesDeleted: totalDeleted,
      ...(hasConflicts ? { conflicts } : {}),
    };
  }

  private async applyFileChange(
    change: FileChange,
    fullPath: string,
    dryRun: boolean,
  ): Promise<{
    linesAdded: number;
    linesDeleted: number;
    conflict?: ConflictInfo;
  }> {
    // Check if file exists
    const fileExists = await this.reader.exists(fullPath);
    if (!fileExists) {
      return {
        linesAdded: 0,
        linesDeleted: 0,
        conflict: {
          filePath: change.filePath,
          reason: `File not found: ${change.filePath}`,
          suggestion: 'Ensure the file exists in the repository before applying the patch.',
        },
      };
    }

    // Read current file content
    const originalContent = await this.reader.readFile(fullPath);
    const originalLines = originalContent.split('\n');

    // Apply hunks sequentially, tracking line offset
    let currentLines = [...originalLines];
    let offset = 0;
    let linesAdded = 0;
    let linesDeleted = 0;

    for (const hunk of change.hunks) {
      const parsed = parseHunkLines(hunk);
      const startIndex = hunk.oldStart - 1 + offset;

      // Verify context lines match (conflict detection)
      const contextConflict = this.verifyContext(
        currentLines,
        parsed,
        startIndex,
        change.filePath,
      );
      if (contextConflict) {
        return { linesAdded: 0, linesDeleted: 0, conflict: contextConflict };
      }

      // Build the replacement lines
      const { newLines, added, deleted } = this.buildReplacement(parsed);
      linesAdded += added;
      linesDeleted += deleted;

      // Splice the old lines out and new lines in
      currentLines.splice(startIndex, hunk.oldLines, ...newLines);
      offset += newLines.length - hunk.oldLines;
    }

    // Write the modified file (unless dry-run)
    if (!dryRun) {
      await this.writer.writeFile(fullPath, currentLines.join('\n'));
    }

    return { linesAdded, linesDeleted };
  }

  /**
   * Verify that context lines in the hunk match the current file content.
   * Returns a ConflictInfo if there's a mismatch, undefined otherwise.
   */
  private verifyContext(
    currentLines: string[],
    parsed: ParsedLine[],
    startIndex: number,
    filePath: string,
  ): ConflictInfo | undefined {
    let fileLineIndex = startIndex;

    for (const line of parsed) {
      if (line.type === 'context' || line.type === 'delete') {
        if (fileLineIndex >= currentLines.length) {
          return {
            filePath,
            reason: `Unexpected end of file at line ${fileLineIndex + 1}. Expected: "${line.content}"`,
            suggestion:
              'The file may have been modified since the patch was generated. Re-run the analysis to generate an updated patch.',
          };
        }
        const actual = currentLines[fileLineIndex];
        if (actual !== line.content) {
          return {
            filePath,
            reason: `Context mismatch at line ${fileLineIndex + 1}. Expected: "${line.content}", found: "${actual}"`,
            suggestion:
              'The file has been modified since the patch was generated. Review the changes manually or re-run the analysis.',
          };
        }
        fileLineIndex++;
      } else {
        // 'add' lines don't consume file lines
      }
    }

    return undefined;
  }

  /**
   * Build the replacement lines from parsed hunk lines.
   * Returns the new lines to insert and counts of added/deleted lines.
   */
  private buildReplacement(parsed: ParsedLine[]): {
    newLines: string[];
    added: number;
    deleted: number;
  } {
    const newLines: string[] = [];
    let added = 0;
    let deleted = 0;

    for (const line of parsed) {
      switch (line.type) {
        case 'context':
          newLines.push(line.content);
          break;
        case 'add':
          newLines.push(line.content);
          added++;
          break;
        case 'delete':
          deleted++;
          break;
      }
    }

    return { newLines, added, deleted };
  }
}
