import simpleGit, { type SimpleGit } from 'simple-git';
import type { GitCommit } from '../types.js';

/** A single line of blame output */
export interface BlameLine {
  hash: string;
  author: string;
  date: Date;
  line: number;
  content: string;
}

export class GitProvider {
  private git: SimpleGit;

  constructor(repoPath: string);
  constructor(git: SimpleGit);
  constructor(repoPathOrGit: string | SimpleGit) {
    this.git =
      typeof repoPathOrGit === 'string' ? (simpleGit as unknown as (path: string) => SimpleGit)(repoPathOrGit) : repoPathOrGit;
  }

  /**
   * Get the most recent N commits that touched a given file.
   */
  async getFileHistory(filePath: string, limit: number): Promise<GitCommit[]> {
    const log = await this.git.log({
      file: filePath,
      maxCount: limit,
      '--stat': null,
    } as Record<string, unknown>);

    return log.all.map((entry) => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: new Date(entry.date),
      filesChanged: entry.diff?.files.map((f) => f.file) ?? [],
      diff: entry.diff
        ? `${entry.diff.changed} files changed, ${entry.diff.insertions} insertions(+), ${entry.diff.deletions} deletions(-)`
        : undefined,
    }));
  }

  /**
   * Get blame information for a range of lines in a file.
   */
  async getBlame(filePath: string, startLine: number, endLine: number): Promise<BlameLine[]> {
    const raw = await this.git.raw([
      'blame',
      '-L',
      `${startLine},${endLine}`,
      '--porcelain',
      filePath,
    ]);

    return parsePorcelainBlame(raw);
  }

  /**
   * Check whether a file path is ignored by .gitignore.
   */
  async isIgnored(filePath: string): Promise<boolean> {
    const ignored = await this.git.checkIgnore(filePath);
    return ignored.length > 0;
  }
}

/**
 * Parse `git blame --porcelain` output into structured BlameLine objects.
 *
 * Porcelain format groups look like:
 *   <hash> <orig-line> <final-line> [<num-lines>]
 *   author <name>
 *   author-time <timestamp>
 *   ...
 *   \t<content>
 */
export function parsePorcelainBlame(raw: string): BlameLine[] {
  const lines = raw.split('\n');
  const result: BlameLine[] = [];

  let i = 0;
  while (i < lines.length) {
    const headerMatch = lines[i]?.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (!headerMatch) {
      i++;
      continue;
    }

    const hash = headerMatch[1];
    const lineNumber = parseInt(headerMatch[2], 10);

    let author = '';
    let date = new Date(0);

    i++;
    // Read header fields until we hit the content line (starts with \t)
    while (i < lines.length && !lines[i].startsWith('\t')) {
      if (lines[i].startsWith('author ')) {
        author = lines[i].slice('author '.length);
      } else if (lines[i].startsWith('author-time ')) {
        date = new Date(parseInt(lines[i].slice('author-time '.length), 10) * 1000);
      }
      i++;
    }

    // Content line starts with \t
    const content = i < lines.length ? lines[i].slice(1) : '';
    i++;

    result.push({ hash, author, date, line: lineNumber, content });
  }

  return result;
}
