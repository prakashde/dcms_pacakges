/**
 * Batch evaluation adapter.
 *
 * Why this exists: bulk Record workflows should reuse one qualified CompiledFormPlan rather than recompile the same
 * Form for every Record. The adapter is intentionally thin so batch behavior cannot diverge from evaluateRecord().
 */
import type { CompiledFormPlan, RecordEvaluation, Scalar } from "./types.js";
import { evaluateRecord } from "./compile.js";

export interface BatchRecordInput {
  recordId: string;
  entered: ReadonlyMap<string, Scalar>;
}
export interface BatchRecordResult {
  recordId: string;
  evaluation: RecordEvaluation;
}

/**
 * Evaluate records synchronously, in input order, against one reusable Form plan.
 * Record IDs are carried through unchanged. A malformed input throws and stops the
 * batch; this helper provides neither transaction handling nor per-record retries.
 */
export function evaluateBatch(
  plan: CompiledFormPlan,
  records: readonly BatchRecordInput[]
): BatchRecordResult[] {
  return records.map((r) => ({
    recordId: r.recordId,
    evaluation: evaluateRecord(plan, r.entered)
  }));
}
