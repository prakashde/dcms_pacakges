/**
 * Application-facing import/export helpers for strict Workbench package v2.
 *
 * Transport parsing, off-screen preparation, and accepted-state publication
 * remain separate boundaries. These helpers capture one coherent application
 * authority for export, or retain the exact authority used to prepare a
 * record-values import until the person accepts it.
 */
import type { DcmsValue } from "@dcms/form-rules";
import type {
  DcmsCompleteRevisionPackageV2,
  DcmsRecordValuesPackageV2,
  DcmsRevisionIdentityV2,
  DcmsWorkbenchPackageScopeV2
} from "./workbench-package-contracts.js";
import {
  prepareRecordValuesPackageV2,
  type PreparedRecordValuesPackageV2
} from "./workbench-package-preparation.js";
import type {
  WorkbenchRevisionSessionAuthorityV2,
  WorkbenchRevisionSessionManagerSnapshotV2,
  WorkbenchRevisionSessionManagerV2
} from "./workbench-revision-session.js";

function revisionIdentity(
  revision: WorkbenchRevisionSessionManagerSnapshotV2["session"]["revision"]
): DcmsRevisionIdentityV2 {
  return {
    productId: revision.productId,
    revisionId: revision.revisionId,
    revisionLabel: revision.revisionLabel,
    documentId: revision.documentId
  };
}

function valueRecord(
  values: ReadonlyMap<string, DcmsValue>
): Record<string, DcmsValue> {
  return Object.fromEntries(
    [...values].map(([fieldId, value]) => [
      fieldId,
      Array.isArray(value) ? structuredClone(value) : value
    ])
  );
}

function formByNode(
  authority: WorkbenchRevisionSessionAuthorityV2,
  nodeId: string
) {
  const form = authority.storeSnapshot.forms.find(
    (candidate) => candidate.nodeId === nodeId
  );
  if (!form) {
    throw new Error(
      `Accepted Workbench snapshot is missing Form node ${nodeId}.`
    );
  }
  return form;
}

/** Create a portable values-only package from one exact accepted authority. */
export function createRecordValuesPackageV2FromAuthority(
  authority: WorkbenchRevisionSessionAuthorityV2
): DcmsRecordValuesPackageV2 {
  const { session } = authority.managerSnapshot;
  if (authority.storeSnapshot.revisionId !== session.revision.revisionId) {
    throw new Error("Workbench session and accepted store Revision disagree.");
  }
  return {
    kind: "dcms-workbench-package",
    schemaVersion: 2,
    scope: "record-values",
    revision: revisionIdentity(session.revision),
    records: session.forms.map((sessionForm) => {
      const form = formByNode(authority, sessionForm.nodeId);
      return {
        nodeId: form.nodeId,
        formId: form.definition.formId,
        formVersion: form.definition.version,
        definitionFingerprint: form.definitionFingerprint,
        currentValues: valueRecord(form.values),
        originalValues: valueRecord(form.originalValues)
      };
    })
  };
}

/** Create a complete portable Revision from one exact accepted authority. */
export function createCompleteRevisionPackageV2FromAuthority(
  authority: WorkbenchRevisionSessionAuthorityV2
): DcmsCompleteRevisionPackageV2 {
  const { session } = authority.managerSnapshot;
  if (authority.storeSnapshot.revisionId !== session.revision.revisionId) {
    throw new Error("Workbench session and accepted store Revision disagree.");
  }
  const activeNodeId = authority.storeSnapshot.activeNodeId;
  if (!activeNodeId) {
    throw new Error("The accepted Workbench Revision has no active Form node.");
  }
  return {
    kind: "dcms-workbench-package",
    schemaVersion: 2,
    scope: "complete-revision",
    revision: structuredClone(session.revision),
    activeNodeId,
    forms: session.forms.map((sessionForm) => {
      const form = formByNode(authority, sessionForm.nodeId);
      return {
        nodeId: form.nodeId,
        title: form.title,
        scenario: sessionForm.scenario,
        seed: sessionForm.seed,
        section: sessionForm.section,
        step: sessionForm.step,
        docDescription: form.docDescription,
        recordDescription: form.recordDescription,
        model: structuredClone(sessionForm.model),
        definition: structuredClone(form.definition),
        currentValues: valueRecord(form.values),
        originalValues: valueRecord(form.originalValues)
      };
    })
  };
}

function safeFilenameSegment(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return normalized || "revision";
}

/** Stable filename for a package export; equal Revision/scope yields equal name. */
export function workbenchPackageFilenameV2(
  revision: DcmsRevisionIdentityV2,
  scope: DcmsWorkbenchPackageScopeV2
): string {
  return `dcms-${safeFilenameSegment(revision.revisionId)}-${scope}-v2.json`;
}

export interface WorkbenchRecordValuesImportSummaryV2 {
  readonly currentRevisionLabel: string;
  readonly recordCount: number;
  readonly currentCanSubmitCount: number;
  readonly currentBlockingRecordCount: number;
  readonly currentWarningRecordCount: number;
  readonly currentEvaluationErrorRecordCount: number;
  readonly originalCanSubmitCount: number;
  readonly diagnosticCount: number;
  readonly warningDiagnosticCount: number;
  readonly errorDiagnosticCount: number;
}

export interface WorkbenchRecordValuesImportProposalV2 {
  readonly prepared: PreparedRecordValuesPackageV2;
  readonly authority: WorkbenchRevisionSessionAuthorityV2;
  readonly summary: WorkbenchRecordValuesImportSummaryV2;
}

export type WorkbenchRecordValuesImportResultV2 =
  | {
      readonly accepted: true;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
      readonly notificationErrors: readonly string[];
      readonly summary: WorkbenchRecordValuesImportSummaryV2;
    }
  | {
      readonly accepted: false;
      readonly code: "RECORD_VALUES_AUTHORITY_STALE";
      readonly error: string;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
      readonly summary: WorkbenchRecordValuesImportSummaryV2;
    };

function recordValuesSummary(
  managerSnapshot: WorkbenchRevisionSessionManagerSnapshotV2,
  prepared: PreparedRecordValuesPackageV2
): WorkbenchRecordValuesImportSummaryV2 {
  return Object.freeze({
    currentRevisionLabel: managerSnapshot.session.revision.revisionLabel,
    recordCount: prepared.summary.current.recordCount,
    currentCanSubmitCount: prepared.summary.current.canSubmitCount,
    currentBlockingRecordCount: prepared.summary.current.blockingRecordCount,
    currentWarningRecordCount: prepared.summary.current.warningRecordCount,
    currentEvaluationErrorRecordCount:
      prepared.summary.current.evaluationErrorRecordCount,
    originalCanSubmitCount: prepared.summary.original.canSubmitCount,
    diagnosticCount: prepared.diagnostics.length,
    warningDiagnosticCount: prepared.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning"
    ).length,
    errorDiagnosticCount: prepared.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    ).length
  });
}

/** Parse preparation authority from the exact current application session. */
export function createWorkbenchRecordValuesImportProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  value: DcmsRecordValuesPackageV2
): WorkbenchRecordValuesImportProposalV2 {
  const authority = manager.captureAuthority();
  const prepared = prepareRecordValuesPackageV2(value, {
    revision: revisionIdentity(authority.managerSnapshot.session.revision),
    forms: authority.storeSnapshot.forms.map((form) => ({
      nodeId: form.nodeId,
      definition: form.definition
    }))
  });
  return Object.freeze({
    prepared,
    authority,
    summary: recordValuesSummary(authority.managerSnapshot, prepared)
  });
}

/** Apply current and Original value sets atomically if captured authority is current. */
export function confirmWorkbenchRecordValuesImportV2(
  manager: WorkbenchRevisionSessionManagerV2,
  proposal: WorkbenchRecordValuesImportProposalV2
): WorkbenchRecordValuesImportResultV2 {
  const current = manager.getSnapshot();
  if (
    current !== proposal.authority.managerSnapshot ||
    current.session.store.getSnapshot() !== proposal.authority.storeSnapshot
  ) {
    return Object.freeze({
      accepted: false,
      code: "RECORD_VALUES_AUTHORITY_STALE" as const,
      error:
        "The working Revision changed after the Record-values package was prepared.",
      snapshot: current,
      summary: proposal.summary
    });
  }

  const updates = Object.fromEntries(
    proposal.prepared.records.map((record) => [
      record.nodeId,
      {
        currentValues: record.current.values,
        originalValues: record.original.values
      }
    ])
  );
  const notificationErrors =
    current.session.store.replaceRecordStateBatch(updates);
  return Object.freeze({
    accepted: true,
    snapshot: manager.getSnapshot(),
    notificationErrors,
    summary: proposal.summary
  });
}
