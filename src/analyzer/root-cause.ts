// Root Cause Analyzer — LLM-powered bug root cause analysis with streaming

import type { LLMProvider } from '../llm/provider.js';
import type {
  ContextWindow,
  BugReport,
  RootCauseReport,
  RootCauseCandidate,
  ChatMessage,
} from '../types.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Options for root cause analysis */
export interface AnalyzeOptions {
  maxCandidates: number; // default 3
  stream: boolean;
}

/** A chunk emitted during streaming analysis */
export interface AnalysisChunk {
  type: 'progress' | 'candidate' | 'complete';
  data: string | RootCauseCandidate | RootCauseReport;
}

// ─── Default Options ─────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: AnalyzeOptions = {
  maxCandidates: 3,
  stream: true,
};

// ─── Root Cause Analyzer ─────────────────────────────────────────────────────

/**
 * Analyzes bug root causes using an LLM provider.
 * Yields streaming AnalysisChunk objects for progress, candidates, and the final report.
 */
export class RootCauseAnalyzer {
  private readonly llm: LLMProvider;

  constructor(llm: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Analyze the root cause of a bug given context and a bug report.
   * Yields AnalysisChunk objects for streaming progress.
   */
  async *analyze(
    context: ContextWindow,
    report: BugReport,
    options?: Partial<AnalyzeOptions>,
  ): AsyncIterable<AnalysisChunk> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    yield { type: 'progress', data: 'Building analysis prompt...' };

    const messages = this.buildMessages(context, report, opts);

    yield { type: 'progress', data: 'Sending context to LLM for analysis...' };

    // Collect the full LLM response
    let fullResponse = '';
    for await (const chunk of this.llm.chat(messages, {
      temperature: 0.2,
      maxTokens: 4096,
      stream: opts.stream,
    })) {
      fullResponse += chunk;
    }

    yield { type: 'progress', data: 'Parsing analysis results...' };

    const rootCauseReport = this.parseResponse(fullResponse, opts.maxCandidates);

    // Yield each candidate individually
    for (const candidate of rootCauseReport.candidates) {
      yield { type: 'candidate', data: candidate };
    }

    yield { type: 'complete', data: rootCauseReport };
  }

  /**
   * Build the system and user messages for the LLM call.
   */
  buildMessages(
    context: ContextWindow,
    report: BugReport,
    options: AnalyzeOptions,
  ): ChatMessage[] {
    const systemPrompt = this.buildSystemPrompt(options);
    const userPrompt = this.buildUserPrompt(context, report);

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Build the system prompt instructing the LLM how to analyze the bug.
   */
  private buildSystemPrompt(options: AnalyzeOptions): string {
    return `You are an expert software debugger and root cause analyst. Your task is to analyze a bug report along with relevant source code context and identify the root cause(s) of the bug.

You MUST respond with valid JSON in the following format:
{
  "candidates": [
    {
      "rank": 1,
      "confidence": 0.95,
      "location": { "path": "src/file.ts", "line": 42 },
      "description": "Description of the root cause",
      "impact": "Description of the impact/scope",
      "evidence": [
        { "type": "code-snippet", "content": "relevant code", "source": "src/file.ts:42" }
      ]
    }
  ],
  "summary": "Brief summary of the analysis"
}

Rules:
- Provide up to ${options.maxCandidates} candidate root causes.
- Sort candidates by confidence (highest first).
- Confidence values must be between 0 and 1.
- Each candidate must include: location (file path and line), description, impact, and evidence.
- Evidence types can be: "code-snippet", "git-history", or "dependency".
- Be specific and reference actual code from the provided context.
- Respond ONLY with the JSON object, no additional text.`;
  }

  /**
   * Build the user prompt containing the context window files and bug report.
   */
  private buildUserPrompt(context: ContextWindow, report: BugReport): string {
    const parts: string[] = [];

    // Bug report section
    parts.push('## Bug Report');
    if (report.errorType) {
      parts.push(`Error Type: ${report.errorType}`);
    }
    if (report.errorMessage) {
      parts.push(`Error Message: ${report.errorMessage}`);
    }
    if (report.description) {
      parts.push(`Description: ${report.description}`);
    }
    parts.push(`Raw Input: ${report.rawInput}`);

    // Stack trace
    if (report.stackTrace && report.stackTrace.length > 0) {
      parts.push('\n## Stack Trace');
      for (const frame of report.stackTrace) {
        const loc = frame.column
          ? `${frame.filePath}:${frame.line}:${frame.column}`
          : `${frame.filePath}:${frame.line}`;
        const fn = frame.functionName ? ` in ${frame.functionName}` : '';
        parts.push(`  at ${loc}${fn}`);
      }
    }

    // File references from bug report
    if (report.filePaths.length > 0) {
      parts.push('\n## Referenced Files');
      for (const ref of report.filePaths) {
        const loc = ref.line ? `${ref.path}:${ref.line}` : ref.path;
        parts.push(`- ${loc}`);
      }
    }

    // Context files
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
   * Parse the LLM JSON response into a structured RootCauseReport.
   * Sorts candidates by confidence descending and assigns ranks.
   */
  parseResponse(response: string, maxCandidates: number): RootCauseReport {
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
      // Return a fallback report if JSON parsing fails
      return {
        candidates: [],
        summary: `Failed to parse LLM response as JSON. Raw response: ${trimmed.slice(0, 200)}`,
      };
    }

    const obj = parsed as Record<string, unknown>;

    // Extract summary
    const summary = typeof obj.summary === 'string' ? obj.summary : 'No summary provided';

    // Extract and validate candidates
    const rawCandidates = Array.isArray(obj.candidates) ? obj.candidates : [];
    const candidates: RootCauseCandidate[] = rawCandidates
      .map((c: unknown) => this.parseCandidate(c))
      .filter((c): c is RootCauseCandidate => c !== null)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxCandidates)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    return { candidates, summary };
  }

  /**
   * Parse a single candidate from the LLM response.
   * Returns null if the candidate is invalid.
   */
  private parseCandidate(raw: unknown): RootCauseCandidate | null {
    if (!raw || typeof raw !== 'object') return null;

    const c = raw as Record<string, unknown>;

    const confidence = typeof c.confidence === 'number' ? Math.max(0, Math.min(1, c.confidence)) : 0;
    const description = typeof c.description === 'string' ? c.description : '';
    const impact = typeof c.impact === 'string' ? c.impact : '';

    if (!description) return null;

    // Parse location
    const loc = c.location as Record<string, unknown> | undefined;
    const location = {
      path: typeof loc?.path === 'string' ? loc.path : 'unknown',
      line: typeof loc?.line === 'number' ? loc.line : undefined,
      column: typeof loc?.column === 'number' ? loc.column : undefined,
    };

    // Parse evidence array
    const rawEvidence = Array.isArray(c.evidence) ? c.evidence : [];
    const evidence = rawEvidence
      .filter((e: unknown) => e && typeof e === 'object')
      .map((e: unknown) => {
        const ev = e as Record<string, unknown>;
        return {
          type: (['code-snippet', 'git-history', 'dependency'].includes(ev.type as string)
            ? ev.type
            : 'code-snippet') as 'code-snippet' | 'git-history' | 'dependency',
          content: typeof ev.content === 'string' ? ev.content : '',
          source: typeof ev.source === 'string' ? ev.source : '',
        };
      });

    return {
      rank: 0, // will be reassigned after sorting
      confidence,
      location,
      description,
      impact,
      evidence,
    };
  }
}
