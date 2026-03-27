import type { RootCauseReport, Patch } from '../types.js';
import type { ApplyResult } from '../patch/applier.js';
import type { OutputFormatter } from './formatter.js';

// ─── JsonFormatter ───────────────────────────────────────────────────────────

export class JsonFormatter implements OutputFormatter {
  formatAnalysis(report: RootCauseReport): string {
    return JSON.stringify(report, null, 2);
  }

  formatPatch(patch: Patch): string {
    return JSON.stringify(patch, null, 2);
  }

  formatApplyResult(result: ApplyResult): string {
    return JSON.stringify(result, null, 2);
  }
}
