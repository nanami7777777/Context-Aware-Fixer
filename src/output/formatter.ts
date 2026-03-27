import type { RootCauseReport, Patch, OutputMode } from '../types.js';
import type { ApplyResult } from '../patch/applier.js';
import { TerminalFormatter } from './terminal.js';
import { JsonFormatter } from './json.js';

// ─── Interface ───────────────────────────────────────────────────────────────

export interface OutputFormatter {
  formatAnalysis(report: RootCauseReport): string;
  formatPatch(patch: Patch): string;
  formatApplyResult(result: ApplyResult): string;
}

// ─── Plain Formatter ─────────────────────────────────────────────────────────

export class PlainFormatter implements OutputFormatter {
  formatAnalysis(report: RootCauseReport): string {
    const lines: string[] = [];
    lines.push('Root Cause Analysis');
    lines.push('===================');
    lines.push('');
    lines.push(`Summary: ${report.summary}`);
    lines.push('');

    for (const candidate of report.candidates) {
      lines.push(`#${candidate.rank} [confidence: ${(candidate.confidence * 100).toFixed(0)}%]`);
      lines.push(`  Location: ${candidate.location.path}${candidate.location.line ? `:${candidate.location.line}` : ''}`);
      lines.push(`  Description: ${candidate.description}`);
      lines.push(`  Impact: ${candidate.impact}`);
      if (candidate.evidence.length > 0) {
        lines.push('  Evidence:');
        for (const ev of candidate.evidence) {
          lines.push(`    - [${ev.type}] ${ev.source}: ${ev.content}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatPatch(patch: Patch): string {
    const lines: string[] = [];
    lines.push(`Patch: ${patch.id}`);
    lines.push(`Description: ${patch.description}`);
    lines.push('');

    if (patch.pros && patch.pros.length > 0) {
      lines.push('Pros:');
      for (const pro of patch.pros) {
        lines.push(`  + ${pro}`);
      }
    }
    if (patch.cons && patch.cons.length > 0) {
      lines.push('Cons:');
      for (const con of patch.cons) {
        lines.push(`  - ${con}`);
      }
    }
    if ((patch.pros && patch.pros.length > 0) || (patch.cons && patch.cons.length > 0)) {
      lines.push('');
    }

    for (const change of patch.changes) {
      lines.push(`--- ${change.filePath}`);
      lines.push(`+++ ${change.filePath}`);
      lines.push(`Explanation: ${change.explanation}`);
      for (const hunk of change.hunks) {
        lines.push(hunk.content);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatApplyResult(result: ApplyResult): string {
    const lines: string[] = [];

    if (result.success) {
      lines.push('Patch applied successfully.');
      lines.push(`Files modified: ${result.filesModified.join(', ')}`);
      lines.push(`Lines added: ${result.linesAdded}, Lines deleted: ${result.linesDeleted}`);
    } else {
      lines.push('Patch application failed.');
      if (result.conflicts && result.conflicts.length > 0) {
        lines.push('Conflicts:');
        for (const conflict of result.conflicts) {
          lines.push(`  ${conflict.filePath}: ${conflict.reason}`);
          lines.push(`    Suggestion: ${conflict.suggestion}`);
        }
      }
    }

    return lines.join('\n');
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an OutputFormatter for the given mode.
 * When mode is 'terminal' but stdout is not a TTY, falls back to 'plain'.
 */
export function createFormatter(mode: OutputMode): OutputFormatter {
  const effectiveMode = resolveMode(mode);

  switch (effectiveMode) {
    case 'terminal':
      return new TerminalFormatter();
    case 'json':
      return new JsonFormatter();
    case 'plain':
      return new PlainFormatter();
    default:
      return new PlainFormatter();
  }
}

/** Resolve the effective output mode, auto-detecting TTY status. */
function resolveMode(mode: OutputMode): OutputMode {
  if (mode === 'terminal' && !process.stdout.isTTY) {
    return 'plain';
  }
  return mode;
}
