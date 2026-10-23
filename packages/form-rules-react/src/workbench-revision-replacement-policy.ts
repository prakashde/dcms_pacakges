/**
 * Confirmation policy for replacing one complete Workbench Revision session.
 *
 * B2 prepares a candidate without publication and B3 provides the atomic
 * compare-and-swap boundary. This module captures the authority used to show a
 * package summary, records whether accepted Form authoring work is unsaved, and
 * requires an explicit discard confirmation before that work can be replaced.
 */
import type { PreparedCompleteRevisionPackageV2 } from "./workbench-package-preparation.js";
import type {
  WorkbenchRevisionSessionAuthorityV2,
  WorkbenchRevisionSessionConstructionOptionsV2,
  WorkbenchRevisionSessionManagerSnapshotV2,
  WorkbenchRevisionSessionManagerV2,
  WorkbenchRevisionSessionReplacementErrorCode
} from "./workbench-revision-session.js";

export interface WorkbenchUnsavedFormSummaryV2 {
  readonly nodeId: string;
  readonly title: string;
}

export interface WorkbenchCompleteRevisionReplacementSummaryV2 {
  readonly current: {
    readonly revisionId: string;
    readonly revisionLabel: string;
    readonly formCount: number;
    readonly unsavedFormCount: number;
    readonly unsavedForms: readonly WorkbenchUnsavedFormSummaryV2[];
    readonly revisionSubmitted: boolean;
  };
  readonly candidate: {
    readonly revisionId: string;
    readonly revisionLabel: string;
    readonly profile: string;
    readonly activeNodeId: string;
    readonly formCount: number;
    readonly fieldCount: number;
    readonly validationRowCount: number;
    readonly currentCanSubmitCount: number;
    readonly currentBlockingRecordCount: number;
    readonly currentWarningRecordCount: number;
    readonly currentEvaluationErrorRecordCount: number;
    readonly originalCanSubmitCount: number;
    readonly diagnosticCount: number;
    readonly warningDiagnosticCount: number;
    readonly errorDiagnosticCount: number;
  };
  readonly requiresUnsavedConfirmation: boolean;
}

/**
 * Immutable proposal shown to a person before replacement. The captured
 * authority is intentionally retained so acceptance can fail safely if the
 * working Revision changes while the summary is being reviewed.
 */
export interface WorkbenchCompleteRevisionReplacementProposalV2 {
  readonly prepared: PreparedCompleteRevisionPackageV2;
  readonly authority: WorkbenchRevisionSessionAuthorityV2;
  readonly summary: WorkbenchCompleteRevisionReplacementSummaryV2;
}

export type WorkbenchCompleteRevisionReplacementPolicyErrorCode =
  | "REPLACEMENT_UNSAVED_CONFIRMATION_REQUIRED"
  | WorkbenchRevisionSessionReplacementErrorCode;

export type WorkbenchCompleteRevisionReplacementPolicyResultV2 =
  | {
      readonly accepted: true;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
      readonly notificationErrors: readonly string[];
      readonly summary: WorkbenchCompleteRevisionReplacementSummaryV2;
    }
  | {
      readonly accepted: false;
      readonly code: WorkbenchCompleteRevisionReplacementPolicyErrorCode;
      readonly error: string;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
      readonly summary: WorkbenchCompleteRevisionReplacementSummaryV2;
    };

function frozenUnsavedForms(
  authority: WorkbenchRevisionSessionAuthorityV2
): readonly WorkbenchUnsavedFormSummaryV2[] {
  return Object.freeze(
    authority.storeSnapshot.forms
      .filter((form) => form.dirty)
      .map((form) => Object.freeze({ nodeId: form.nodeId, title: form.title }))
  );
}

function replacementSummary(
  authority: WorkbenchRevisionSessionAuthorityV2,
  prepared: PreparedCompleteRevisionPackageV2
): WorkbenchCompleteRevisionReplacementSummaryV2 {
  const unsavedForms = frozenUnsavedForms(authority);
  const warningDiagnosticCount = prepared.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning"
  ).length;
  const errorDiagnosticCount = prepared.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  ).length;

  return Object.freeze({
    current: Object.freeze({
      revisionId: authority.managerSnapshot.session.revision.revisionId,
      revisionLabel: authority.managerSnapshot.session.revision.revisionLabel,
      formCount: authority.storeSnapshot.forms.length,
      unsavedFormCount: unsavedForms.length,
      unsavedForms,
      revisionSubmitted: authority.storeSnapshot.revisionSubmitted
    }),
    candidate: Object.freeze({
      revisionId: prepared.revision.revisionId,
      revisionLabel: prepared.revision.revisionLabel,
      profile: prepared.revision.profile,
      activeNodeId: prepared.activeNodeId,
      formCount: prepared.summary.formCount,
      fieldCount: prepared.summary.fieldCount,
      validationRowCount: prepared.summary.validationRowCount,
      currentCanSubmitCount: prepared.summary.current.canSubmitCount,
      currentBlockingRecordCount: prepared.summary.current.blockingRecordCount,
      currentWarningRecordCount: prepared.summary.current.warningRecordCount,
      currentEvaluationErrorRecordCount:
        prepared.summary.current.evaluationErrorRecordCount,
      originalCanSubmitCount: prepared.summary.original.canSubmitCount,
      diagnosticCount: prepared.diagnostics.length,
      warningDiagnosticCount,
      errorDiagnosticCount
    }),
    requiresUnsavedConfirmation: unsavedForms.length > 0
  });
}

/** Build a replacement proposal from the exact authority used to derive a candidate. */
export function createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2(
  authority: WorkbenchRevisionSessionAuthorityV2,
  prepared: PreparedCompleteRevisionPackageV2
): WorkbenchCompleteRevisionReplacementProposalV2 {
  return Object.freeze({
    prepared,
    authority,
    summary: replacementSummary(authority, prepared)
  });
}

/** Capture authority before producing the summary presented for confirmation. */
export function createWorkbenchCompleteRevisionReplacementProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  prepared: PreparedCompleteRevisionPackageV2
): WorkbenchCompleteRevisionReplacementProposalV2 {
  return createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2(
    manager.captureAuthority(),
    prepared
  );
}

/**
 * Accept one previously summarized proposal. No mutation occurs when unsaved
 * work requires confirmation and the caller has not explicitly supplied it.
 * B3 rechecks the captured authority immediately before atomic replacement.
 */
export function confirmWorkbenchCompleteRevisionReplacementV2(
  manager: WorkbenchRevisionSessionManagerV2,
  proposal: WorkbenchCompleteRevisionReplacementProposalV2,
  options: {
    readonly confirmDiscardUnsaved: boolean;
    readonly sessionOptions?: WorkbenchRevisionSessionConstructionOptionsV2;
  }
): WorkbenchCompleteRevisionReplacementPolicyResultV2 {
  if (
    proposal.summary.requiresUnsavedConfirmation &&
    !options.confirmDiscardUnsaved
  ) {
    return Object.freeze({
      accepted: false,
      code: "REPLACEMENT_UNSAVED_CONFIRMATION_REQUIRED",
      error: `Replacement would discard ${proposal.summary.current.unsavedFormCount} unsaved Form${
        proposal.summary.current.unsavedFormCount === 1 ? "" : "s"
      }. Explicit confirmation is required.`,
      snapshot: manager.getSnapshot(),
      summary: proposal.summary
    });
  }

  const result = manager.replacePreparedCompleteRevision(
    proposal.prepared,
    proposal.authority,
    options.sessionOptions
  );
  if (!result.accepted) {
    return Object.freeze({
      ...result,
      summary: proposal.summary
    });
  }
  return Object.freeze({
    ...result,
    summary: proposal.summary
  });
}
