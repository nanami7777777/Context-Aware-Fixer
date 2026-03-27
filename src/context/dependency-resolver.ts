import * as path from 'node:path';
import type { ImportDeclaration } from '../types.js';
import type { ASTParser } from './ast-parser.js';

/** A node in the dependency graph */
export interface DependencyNode {
  filePath: string;
  imports: ImportDeclaration[];
  dependencies: string[]; // resolved absolute file paths
}

/** Result of a transitive dependency lookup */
export interface TransitiveDependency {
  filePath: string;
  depth: number;
}

/**
 * Builds and queries a file-level dependency graph.
 *
 * Uses an ASTParser to extract imports from each file, resolves
 * relative paths to absolute file paths, and provides methods
 * for querying direct and transitive dependencies.
 */
export class DependencyResolver {
  private graph = new Map<string, DependencyNode>();

  constructor(
    private parser: ASTParser,
    private repoRoot: string,
  ) {}

  /**
   * Build the dependency graph from a set of files.
   * @param files Map of absolute file paths to their content
   */
  buildGraph(files: Map<string, string>): void {
    this.graph.clear();
    const knownFiles = new Set(files.keys());

    for (const [filePath, content] of files) {
      const imports = this.parser.extractImports(filePath, content);
      const dependencies: string[] = [];

      for (const imp of imports) {
        if (imp.isRelative) {
          const resolved = this.resolveRelativeImport(filePath, imp.source, knownFiles);
          if (resolved) {
            dependencies.push(resolved);
          }
        }
        // Non-relative (package) imports are not tracked in the file graph
      }

      this.graph.set(filePath, { filePath, imports, dependencies });
    }
  }

  /** Get direct dependencies of a file */
  getDependencies(filePath: string): string[] {
    return this.graph.get(filePath)?.dependencies ?? [];
  }

  /**
   * Get transitive dependencies up to a maximum depth.
   * Returns each dependency with its shortest distance from the root.
   */
  getTransitiveDependencies(
    filePath: string,
    maxDepth: number = Infinity,
  ): TransitiveDependency[] {
    const visited = new Map<string, number>(); // filePath -> depth
    const queue: Array<{ file: string; depth: number }> = [];

    // Seed with direct dependencies
    const directDeps = this.getDependencies(filePath);
    for (const dep of directDeps) {
      queue.push({ file: dep, depth: 1 });
    }

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;

      if (depth > maxDepth) continue;
      if (visited.has(file)) continue;
      if (file === filePath) continue; // skip self-references

      visited.set(file, depth);

      const nextDeps = this.getDependencies(file);
      for (const next of nextDeps) {
        if (!visited.has(next) && next !== filePath) {
          queue.push({ file: next, depth: depth + 1 });
        }
      }
    }

    return Array.from(visited.entries()).map(([fp, d]) => ({
      filePath: fp,
      depth: d,
    }));
  }

  /**
   * Calculate the import depth from a root file to a target file.
   * Returns the shortest path length, or -1 if unreachable.
   */
  getImportDepth(rootFile: string, targetFile: string): number {
    if (rootFile === targetFile) return 0;

    const visited = new Set<string>([rootFile]);
    const queue: Array<{ file: string; depth: number }> = [];

    for (const dep of this.getDependencies(rootFile)) {
      queue.push({ file: dep, depth: 1 });
    }

    while (queue.length > 0) {
      const { file, depth } = queue.shift()!;

      if (file === targetFile) return depth;
      if (visited.has(file)) continue;
      visited.add(file);

      for (const next of this.getDependencies(file)) {
        if (!visited.has(next)) {
          queue.push({ file: next, depth: depth + 1 });
        }
      }
    }

    return -1;
  }

  /** Get the full dependency graph */
  getGraph(): ReadonlyMap<string, DependencyNode> {
    return this.graph;
  }

  /** Common extensions to try when resolving extensionless imports */
  private static readonly RESOLVE_EXTENSIONS = [
    '',
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mts',
    '.mjs',
    '.py',
    '.java',
    '.go',
    '.rs',
  ];

  /**
   * Resolve a relative import source to an absolute file path.
   *
   * Handles common patterns:
   * - `./foo` → tries `./foo.ts`, `./foo.js`, `./foo/index.ts`, etc.
   * - `../bar` → resolves relative to the importing file's directory
   * - `./util.js` → strips .js and tries .ts (common in TS projects)
   */
  private resolveRelativeImport(
    importingFile: string,
    importSource: string,
    knownFiles: Set<string>,
  ): string | undefined {
    const dir = path.dirname(importingFile);
    // Strip trailing JS extension aliases (.js → .ts is common in TS projects)
    const cleaned = importSource.replace(/\.(js|mjs|cjs)$/, '');
    const base = path.resolve(dir, cleaned);

    // Try the base path with each extension
    for (const ext of DependencyResolver.RESOLVE_EXTENSIONS) {
      const candidate = base + ext;
      if (knownFiles.has(candidate)) {
        return candidate;
      }
    }

    // Try index files (e.g. ./foo → ./foo/index.ts)
    for (const ext of DependencyResolver.RESOLVE_EXTENSIONS) {
      if (ext === '') continue;
      const candidate = path.join(base, 'index' + ext);
      if (knownFiles.has(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }
}
