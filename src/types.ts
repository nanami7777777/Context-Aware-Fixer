// ContextFix — Core data models and type definitions

// ─── Type Aliases ────────────────────────────────────────────────────────────

/** Input source for bug reports */
export type InputSource = 'cli-arg' | 'stdin' | 'file';

/** Supported programming languages for code analysis */
export type SupportedLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'go' | 'rust';

/** Output formatting mode */
export type OutputMode = 'terminal' | 'json' | 'plain';

// ─── Input Parsing ───────────────────────────────────────────────────────────

/** A reference to a specific location in a file */
export interface FileReference {
  path: string;
  line?: number;
  column?: number;
}

/** A single frame in a parsed stack trace */
export interface StackFrame {
  filePath: string;
  functionName?: string;
  line: number;
  column?: number;
}

/** Bug report — structured output of the input parser */
export interface BugReport {
  rawInput: string;
  source: InputSource;
  errorType?: string;
  errorMessage?: string;
  filePaths: FileReference[];
  stackTrace?: StackFrame[];
  keywords: string[];
  description?: string;
}

/** Generic parse result wrapper */
export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors?: ParseError[];
}

/** Describes a parsing error with optional suggestion */
export interface ParseError {
  field: string;
  message: string;
  suggestion?: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Result of a validation check */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

/** Describes a validation error with optional location and suggestion */
export interface ValidationError {
  field: string;
  message: string;
  line?: number;
  suggestion?: string;
}

// ─── Language Parsing ─────────────────────────────────────────────────────────

/** An import/dependency declaration extracted from source code */
export interface ImportDeclaration {
  source: string;
  specifiers: string[];
  line: number;
  isRelative: boolean;
}

/** A project-level dependency extracted from config files */
export interface ProjectDependency {
  name: string;
  version?: string;
  type: 'runtime' | 'dev' | 'peer';
}

// ─── Context Collection ──────────────────────────────────────────────────────

/** A file included in the context window with relevance metadata */
export interface ContextFile {
  path: string;
  content: string;
  relevanceScore: number;
  tokenCount: number;
  isTruncated: boolean;
  truncationReason?: string;
}

/** Git commit metadata */
export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: Date;
  filesChanged: string[];
  diff?: string;
}

/** Project-level metadata extracted from config files */
export interface ProjectInfo {
  name: string;
  language: SupportedLanguage;
  packageManager?: string;
  dependencies: Record<string, string>;
  configFiles: string[];
}

/** The assembled context window passed to the LLM */
export interface ContextWindow {
  files: ContextFile[];
  gitHistory: GitCommit[];
  projectInfo: ProjectInfo;
  totalTokens: number;
  bugReport: BugReport;
}

// ─── Root Cause Analysis ─────────────────────────────────────────────────────

/** A piece of evidence supporting a root cause candidate */
export interface Evidence {
  type: 'code-snippet' | 'git-history' | 'dependency';
  content: string;
  source: string;
}

/** A single candidate root cause */
export interface RootCauseCandidate {
  rank: number;
  confidence: number;
  location: FileReference;
  description: string;
  impact: string;
  evidence: Evidence[];
}

/** Complete root cause analysis report */
export interface RootCauseReport {
  candidates: RootCauseCandidate[];
  summary: string;
}

// ─── Patch Generation ────────────────────────────────────────────────────────

/** A single hunk in a unified diff */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

/** Changes to a single file as part of a patch */
export interface FileChange {
  filePath: string;
  hunks: DiffHunk[];
  explanation: string;
}

/** A complete repair patch */
export interface Patch {
  id: string;
  description: string;
  changes: FileChange[];
  pros?: string[];
  cons?: string[];
}

/** A set of candidate patches with a recommendation */
export interface PatchSet {
  patches: Patch[];
  recommended: number;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** Application configuration (merged from project, global, and defaults) */
export interface Configuration {
  model: string;
  apiKey?: string;
  contextLimit: number;
  ignorePatterns: string[];
  promptTemplates?: Record<string, string>;
}

// ─── LLM ─────────────────────────────────────────────────────────────────────

/** A message in an LLM chat conversation */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Options for LLM inference calls */
export interface LLMOptions {
  temperature: number;
  maxTokens: number;
  stream: boolean;
}
