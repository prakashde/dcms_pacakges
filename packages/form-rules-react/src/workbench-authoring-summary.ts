/** Pure Form/Revision authoring diagnostics, intentionally independent of Record evaluation. */
import type { WorkbenchFormModel } from "./workbench-model.js";
import type { WorkbenchFormSnapshot } from "./workbench-store.js";
import { summarizeValidationRows } from "./validation-editor.js";

export type WorkbenchFormAuthoringState =
  | "dirty"
  | "error"
  | "warning"
  | "saved";

export interface WorkbenchFormAuthoringSummary {
  readonly dirty: boolean;
  readonly saved: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly state: WorkbenchFormAuthoringState;
}

export interface WorkbenchRevisionAuthoringSummary {
  readonly totalFormCount: number;
  readonly savedFormCount: number;
  readonly unsavedFormCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly formsByNode: Readonly<Record<string, WorkbenchFormAuthoringSummary>>;
}

export type WorkbenchFormAuthoringStatus = Pick<
  WorkbenchFormSnapshot,
  "dirty" | "definitionError"
>;

/**
 * Summarize accepted Form-definition diagnostics only.
 *
 * Current/Original Record values and Record evaluation are deliberately absent
 * from the input so Record edits cannot contaminate the authoring lifecycle.
 */
export function summarizeWorkbenchFormAuthoring(
  model: WorkbenchFormModel,
  status: WorkbenchFormAuthoringStatus
): WorkbenchFormAuthoringSummary {
  let rowErrorCount = 0;
  let warningCount = 0;
  for (const field of model.fields) {
    const summary = summarizeValidationRows(field.validationRows);
    rowErrorCount += summary.blockingIssueCount;
    warningCount += summary.warningCount;
  }

  const errorCount = rowErrorCount + (status.definitionError ? 1 : 0);
  const saved = !status.dirty && errorCount === 0;
  const state: WorkbenchFormAuthoringState = status.dirty
    ? "dirty"
    : errorCount
      ? "error"
      : warningCount
        ? "warning"
        : "saved";

  return Object.freeze({
    dirty: status.dirty,
    saved,
    errorCount,
    warningCount,
    state
  });
}

/** Aggregate one accepted Revision without consulting Record evaluation. */
export function summarizeWorkbenchRevisionAuthoring(
  forms: readonly WorkbenchFormSnapshot[],
  modelsByNode: Readonly<Record<string, WorkbenchFormModel>>
): WorkbenchRevisionAuthoringSummary {
  const formsByNode: Record<string, WorkbenchFormAuthoringSummary> = {};
  let savedFormCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const form of forms) {
    const model = modelsByNode[form.nodeId];
    if (!model) {
      throw new Error(
        `Missing Workbench Form model for authoring summary: ${form.nodeId}`
      );
    }
    const summary = summarizeWorkbenchFormAuthoring(model, form);
    formsByNode[form.nodeId] = summary;
    if (summary.saved) savedFormCount++;
    errorCount += summary.errorCount;
    warningCount += summary.warningCount;
  }

  return Object.freeze({
    totalFormCount: forms.length,
    savedFormCount,
    unsavedFormCount: forms.length - savedFormCount,
    errorCount,
    warningCount,
    formsByNode: Object.freeze(formsByNode)
  });
}
