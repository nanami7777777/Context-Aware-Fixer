// Patch Generator — LLM-powered fix patch generation with streaming

import type { LLMProvider } from '../llm/provider.js';
import type {
  ContextWindow,
  RootCauseReport,
  Patch,
  PatchSet,
  FileChange,
  DiffHunk,
  ChatMessage,
} from '../types.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Options for patch generation */
export interface GenerateOptions {
  maxPatches: number; // default 1
  stream: boolean;
}

/** A chunk emitted during streaming patch generation */
export interface PatchChunk {
  type: 'progress' | 'patch' | 'complete';
  data: string | Patch | PatchSet;
}

// ─── Default Options ─────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: GenerateOptions = {
  maxPatches: 1,
  stream: true,
};

// ─── Patch Generator ─────────────────────────────────────────────────────────

/**
 * Generates fix patches using an LLM provider based on root cause analysis.
 * Yields streaming PatchChunk objects for progress, individual patches, and the final set.
 */
export class PatchGenerator {
  private readonly llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Generate fix patches given a root cause report and context window.
   * Yields PatchChunk objects for streaming progress.
   */
  async *generate(
    report: RootCauseReport,
    context: ContextWindow,
    options?: Partial<GenerateOptions>,
  ): AsyncIterable<PatchChunk> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    yield { type: 'progress', data: 'Building fix prompt...' };

    const messages = this.buildMessages(report, context, opts);

    yield { type: 'progress', data: 'Sending context to LLM for patch generation...' };

    // Collect the full LLM response
    let fullResponse = '';
    for await (const chunk of this.llm.chat(messages, {
      temperature: 0.2,
      maxTokens: 4096,
      stream: opts.stream,
    })) {
      fullResponse += chunk;
    }

    yield { type: 'progress', data: 'Parsing patch results...' };

    const patchSet = this.parseResponse(fullResponse, opts.maxPatches);

    // Yield each patch individually
    for (const patch of patchSet.patches) {
      yield { type: 'patch', data: patch };
    }

    yield { type: 'complete', data: patchSet };
  }

  /**
   * Build the system and user messages for the LLM call.
   */
  buildMessages(
    report: RootCauseReport,
    context: ContextWindow,
    options: GenerateOptions,
  ): ChatMessage[] {
    const systemPrompt = this.buildSystemPrompt(options);
    const userPrompt = this.buildUserPrompt(report, context);

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Build the system prompt instructing the LLM how to generate patches.
   */
  private buildSystemPrompt(options: GenerateOptions): string {
    const multiPatch = options.maxPatches > 1;
    const patchCountInstruction = multiPatch
      ? `Generate up to ${options.maxPatches} candidate patches. For each patch, include "pros" and "cons" arrays explaining the trade-offs of that approach.`
      : 'Generate exactly 1 patch.';

    return `You are an expert software engineer specializing in bug fixes. Your task is to generate repair patches based on a root cause analysis report and relevant source code context.

You MUST respond with valid JSON in the following format:
{
  "patches": [
    {
      "id": "patch-1",
      "description": "Description of what this patch fixes and how",
      "changes": [
        {
          "filePath": "src/file.ts",
          "explanation": "Explanation of why this file is being changed",
          "hunks": [
            {
              "oldStart": 10,
              "oldLines": 3,
              "newStart": 10,
              "newLines": 4,
              "content": "@@ -10,3 +10,4 @@\\n context line\\n-old line\\n+new line\\n+added line\\n context line"
            }
          ]
        }
      ],
      "pros": ["Advantage 1"],
      "cons": ["Disadvantage 1"]
    }
  ],
  "recommended": 0
}

Rules:
- ${patchCountInstruction}
- Each patch must have a unique "id" (e.g. "patch-1", "patch-2").
- Each patch must include a clear "description" explaining the fix.
- File changes must use standard unified diff format in the "content" field of each hunk.
- Unified diff content must start with @@ -oldStart,oldLines +newStart,newLines @@ header.
- Lines prefixed with " " (space) are context lines, "-" are removed lines, "+" are added lines.
- Only modify code lines directly related to fixing the bug. Do not make unrelated changes.
- Ensure the generated code is syntactically correct.
- The "recommended" field is the 0-based index of the best patch.${multiPatch ? '\n- For multiple patches, each MUST include "pros" and "cons" arrays.' : ''}
- Respond ONLY with the JSON object, no additional text.`;
  }

  /**
   * Build the user prompt containing the root cause report and context.
   */
  private buildUserPrompt(report: RootCauseReport, context: ContextWindow): string {
    const parts: string[] = [];

    // Root cause analysis section
    parts.push('## Root Cause Analysis');
    parts.push(`Summary: ${report.summary}`);

    if (report.candidates.length > 0) {
      parts.push('\n### Candidates');
      for (const candidate of report.candidates) {
        parts.push(`\n#### Candidate #${candidate.rank} (confidence: ${candidate.confidence.toFixed(2)})`);
        const loc = candidate.location.line
          ? `${candidate.location.path}:${candidate.location.line}`
          : candidate.location.path;
        parts.push(`Location: ${loc}`);
        parts.push(`Description: ${candidate.description}`);
        parts.push(`Impact: ${candidate.impact}`);

        if (candidate.evidence.length > 0) {
          parts.push('Evidence:');
          for (const ev of candidate.evidence) {
            parts.push(`- [${ev.type}] ${ev.source}: ${ev.content}`);
          }
        }
      }
    }

    // Bug report section
    const bugReport = context.bugReport;
    parts.push('\n## Bug Report');
    if (bugReport.errorType) {
      parts.push(`Error Type: ${bugReport.errorType}`);
    }
    if (bugReport.errorMessage) {
      parts.push(`Error Message: ${bugReport.errorMessage}`);
    }
    if (bugReport.description) {
      parts.push(`Description: ${bugReport.description}`);
    }
    parts.push(`Raw Input: ${bugReport.rawInput}`);

    // Stack trace
    if (bugReport.stackTrace && bugReport.stackTrace.length > 0) {
      parts.push('\n## Stack Trace');
      for (const frame of bugReport.stackTrace) {
        const frameLoc = frame.column
          ? `${frame.filePath}:${frame.line}:${frame.column}`
          : `${frame.filePath}:${frame.line}`;
        const fn = frame.functionName ? ` in ${frame.functionName}` : '';
        parts.push(`  at ${frameLoc}${fn}`);
      }
    }

    // Source code context
    if (context.files.length > 0) {
      parts.push('\n## Source Code Context');
      for (const file of context.files) {
        parts.push(`\n### ${file.path} (relevance: ${file.relevanceScore.toFixed(2)})`);
        if (file.isTruncated) {
          parts.push(`[Truncated: ${file.truncationReason ?? 'token limit'}]`);
        }
        parts.push('```');
        parts.push(file.content);
        parts.push('```');
      }
    }

    // Git history
    if (context.gitHistory.length > 0) {
      parts.push('\n## Recent Git History');
      for (const commit of context.gitHistory) {
        parts.push(`- ${commit.hash.slice(0, 7)} ${commit.message} (${commit.author})`);
        if (commit.diff) {
          parts.push(`  Diff: ${commit.diff}`);
        }
      }
    }

    // Project info
    parts.push('\n## Project Info');
    parts.push(`Name: ${context.projectInfo.name}`);
    parts.push(`Language: ${context.projectInfo.language}`);
    if (context.projectInfo.packageManager) {
      parts.push(`Package Manager: ${context.projectInfo.packageManager}`);
    }

    return parts.join('\n');
  }

  /**
   * Parse the LLM JSON response into a structured PatchSet.
   */
  parseResponse(response: string, maxPatches: number): PatchSet {
    const trimmed = response.trim();

    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = trimmed;
    const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonBlockMatch) {
      jsonStr = jsonBlockMatch[1].trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Return a fallback patch set if JSON parsing fails
      return {
        patches: [],
        recommended: 0,
      };
    }

    const obj = parsed as Record<string, unknown>;

    // Extract and validate patches
    const rawPatches = Array.isArray(obj.patches) ? obj.patches : [];
    const patches: Patch[] = rawPatches
      .map((p: unknown, index: number) => this.parsePatch(p, index))
      .filter((p): p is Patch => p !== null)
      .slice(0, maxPatches);

    // Extract recommended index
    let recommended = typeof obj.recommended === 'number' ? obj.recommended : 0;
    if (recommended < 0 || recommended >= patches.length) {
      recommended = 0;
    }

    return { patches, recommended };
  }

  /**
   * Parse a single patch from the LLM response.
   * Returns null if the patch is invalid.
   */
  private parsePatch(raw: unknown, index: number): Patch | null {
    if (!raw || typeof raw !== 'object') return null;

    const p = raw as Record<string, unknown>;

    const id = typeof p.id === 'string' ? p.id : `patch-${index + 1}`;
    const description = typeof p.description === 'string' ? p.description : '';

    if (!description) return null;

    // Parse changes
    const rawChanges = Array.isArray(p.changes) ? p.changes : [];
    const changes: FileChange[] = rawChanges
      .map((c: unknown) => this.parseFileChange(c))
      .filter((c): c is FileChange => c !== null);

    if (changes.length === 0) return null;

    // Parse pros/cons
    const pros = Array.isArray(p.pros)
      ? p.pros.filter((s: unknown): s is string => typeof s === 'string')
      : undefined;
    const cons = Array.isArray(p.cons)
      ? p.cons.filter((s: unknown): s is string => typeof s === 'string')
      : undefined;

    return { id, description, changes, pros, cons };
  }

  /**
   * Parse a single file change from the LLM response.
   */
  private parseFileChange(raw: unknown): FileChange | null {
    if (!raw || typeof raw !== 'object') return null;

    const c = raw as Record<string, unknown>;

    const filePath = typeof c.filePath === 'string' ? c.filePath : '';
    const explanation = typeof c.explanation === 'string' ? c.explanation : '';

    if (!filePath) return null;

    // Parse hunks
    const rawHunks = Array.isArray(c.hunks) ? c.hunks : [];
    const hunks: DiffHunk[] = rawHunks
      .map((h: unknown) => this.parseDiffHunk(h))
      .filter((h): h is DiffHunk => h !== null);

    if (hunks.length === 0) return null;

    return { filePath, hunks, explanation };
  }

  /**
   * Parse a single diff hunk from the LLM response.
   */
  private parseDiffHunk(raw: unknown): DiffHunk | null {
    if (!raw || typeof raw !== 'object') return null;

    const h = raw as Record<string, unknown>;

    const oldStart = typeof h.oldStart === 'number' ? h.oldStart : 0;
    const oldLines = typeof h.oldLines === 'number' ? h.oldLines : 0;
    const newStart = typeof h.newStart === 'number' ? h.newStart : 0;
    const newLines = typeof h.newLines === 'number' ? h.newLines : 0;
    const content = typeof h.content === 'string' ? h.content : '';

    if (!content) return null;

    return { oldStart, oldLines, newStart, newLines, content };
  }
}
