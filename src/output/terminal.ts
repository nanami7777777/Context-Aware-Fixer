import { Chalk } from 'chalk';
import type { RootCauseReport, Patch } from '../types.js';
import type { ApplyResult } from '../patch/applier.js';
import type { OutputFormatter } from './formatter.js';

// Force color output — TerminalFormatter is only used when TTY is detected.
const chalk = new Chalk({ level: 1 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Color-code a confidence value: green ≥ 0.7, yellow ≥ 0.4, red otherwise */
function colorConfidence(confidence: number): string {
  const pct = `${(confidence * 100).toFixed(0)}%`;
  if (confidence >= 0.7) return chalk.green(pct);
  if (confidence >= 0.4) return chalk.yellow(pct);
  return chalk.red(pct);
}

/** Apply simple syntax highlighting to a diff line */
function colorDiffLine(line: string): string {
  if (line.startsWith('@@')) return chalk.cyan(line);
  if (line.startsWith('+')) return chalk.green(line);
  if (line.startsWith('-')) return chalk.red(line);
  return line;
}

/** Format a progress/stage indicator */
function stageHeader(label: string): string {
  return chalk.bold.blue(`▶ ${label}`);
}

// ─── TerminalFormatter ───────────────────────────────────────────────────────

export class TerminalFormatter implements OutputFormatter {
  formatAnalysis(report: RootCauseReport): string {
    const lines: string[] = [];

    lines.push(stageHeader('Root Cause Analysis'));
    lines.push(chalk.dim('─'.repeat(40)));
    lines.push('');
    lines.push(`${chalk.bold('Summary:')} ${report.summary}`);
    lines.push('');

    for (const candidate of report.candidates) {
      const loc = candidate.location.line
        ? `${candidate.location.path}:${candidate.location.line}`
        : candidate.location.path;

      lines.push(
        `${chalk.bold(`#${candidate.rank}`)} [confidence: ${colorConfidence(candidate.confidence)}]`,
      );
      lines.push(`  ${chalk.bold('Location:')} ${chalk.cyan(loc)}`);
      lines.push(`  ${chalk.bold('Description:')} ${candidate.description}`);
      lines.push(`  ${chalk.bold('Impact:')} ${candidate.impact}`);

      if (candidate.evidence.length > 0) {
        lines.push(`  ${chalk.bold('Evidence:')}`);
        for (const ev of candidate.evidence) {
          lines.push(`    ${chalk.dim('•')} [${chalk.magenta(ev.type)}] ${ev.source}: ${ev.content}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatPatch(patch: Patch): string {
    const lines: string[] = [];

    lines.push(stageHeader('Patch'));
    lines.push(`${chalk.bold('ID:')} ${patch.id}`);
    lines.push(`${chalk.bold('Description:')} ${patch.description}`);
    lines.push('');

    if (patch.pros && patch.pros.length > 0) {
      lines.push(chalk.bold('Pros:'));
      for (const pro of patch.pros) {
        lines.push(chalk.green(`  + ${pro}`));
      }
    }
    if (patch.cons && patch.cons.length > 0) {
      lines.push(chalk.bold('Cons:'));
      for (const con of patch.cons) {
        lines.push(chalk.red(`  - ${con}`));
      }
    }
    if ((patch.pros && patch.pros.length > 0) || (patch.cons && patch.cons.length > 0)) {
      lines.push('');
    }

    for (const change of patch.changes) {
      lines.push(chalk.bold(`--- ${change.filePath}`));
      lines.push(chalk.bold(`+++ ${change.filePath}`));
      lines.push(`${chalk.bold('Explanation:')} ${change.explanation}`);
      for (const hunk of change.hunks) {
        const hunkLines = hunk.content.split('\n');
        for (const hl of hunkLines) {
          lines.push(colorDiffLine(hl));
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatApplyResult(result: ApplyResult): string {
    const lines: string[] = [];

    if (result.success) {
      lines.push(chalk.green.bold('✔ Patch applied successfully.'));
      lines.push(`${chalk.bold('Files modified:')} ${result.filesModified.join(', ')}`);
      lines.push(
        `${chalk.green(`+${result.linesAdded}`)} lines added, ${chalk.red(`-${result.linesDeleted}`)} lines deleted`,
      );
    } else {
      lines.push(chalk.red.bold('✘ Patch application failed.'));
      if (result.conflicts && result.conflicts.length > 0) {
        lines.push(chalk.bold('Conflicts:'));
        for (const conflict of result.conflicts) {
          lines.push(`  ${chalk.red(conflict.filePath)}: ${conflict.reason}`);
          lines.push(`    ${chalk.dim('Suggestion:')} ${conflict.suggestion}`);
        }
      }
    }

    return lines.join('\n');
  }
}
