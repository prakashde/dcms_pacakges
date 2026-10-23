/**
 * Authority-bound Form-description authoring for a complete Workbench session.
 *
 * A working copy owns both description fields for one Form. Confirm prepares a
 * complete Revision candidate and publishes one replacement session so store
 * snapshots and session metadata never expose different accepted descriptions.
 */
import type { DcmsValue } from "@dcms/form-rules";
import {
  DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
  type DcmsCompleteRevisionPackageV2
} from "./workbench-package-contracts.js";
import { prepareCompleteRevisionPackageV2 } from "./workbench-package-preparation.js";
import { createCompleteRevisionPackageV2FromAuthority } from "./workbench-package-transfer.js";
import type {
  WorkbenchRevisionSessionAuthorityV2,
  WorkbenchRevisionSessionManagerSnapshotV2,
  WorkbenchRevisionSessionManagerV2,
  WorkbenchRevisionSessionReplacementErrorCode
} from "./workbench-revision-session.js";

export interface WorkbenchFormDescriptionsV2 {
  readonly docDescription: string;
  readonly recordDescription: string;
}

/** One detached draft bound to the exact accepted authority it was opened from. */
export interface WorkbenchFormDescriptionWorkingCopyV2 {
  readonly nodeId: string;
  readonly formId: string;
  readonly formVersion: string | number;
  readonly authority: WorkbenchRevisionSessionAuthorityV2;
  readonly accepted: WorkbenchFormDescriptionsV2;
  readonly draft: WorkbenchFormDescriptionsV2;
  readonly dirty: boolean;
}

export type WorkbenchFormDescriptionConfirmationErrorCodeV2 =
  | "DESCRIPTION_AUTHORITY_STALE"
  | "DESCRIPTION_CANDIDATE_INVALID"
  | WorkbenchRevisionSessionReplacementErrorCode;

export type WorkbenchFormDescriptionConfirmationResultV2 =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly nodeId: string;
      readonly descriptions: WorkbenchFormDescriptionsV2;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
      readonly notificationErrors: readonly string[];
    }
  | {
      readonly accepted: false;
      readonly code: WorkbenchFormDescriptionConfirmationErrorCodeV2;
      readonly error: string;
      readonly snapshot: WorkbenchRevisionSessionManagerSnapshotV2;
    };

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function checkedDescription(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  if (value.length > DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS) {
    throw new Error(
      `${label} must contain at most ${DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS} characters.`
    );
  }
  return value;
}

/** Canonicalize browser line endings without trimming or rewriting authored text. */
export function normalizeWorkbenchDescriptionTextV2(value: string): string {
  return checkedDescription(value, "Description").replace(/\r\n?/g, "\n");
}

function descriptions(
  docDescription: unknown,
  recordDescription: unknown,
  normalize: boolean
): WorkbenchFormDescriptionsV2 {
  const doc = checkedDescription(
    docDescription,
    "Short Description in Document"
  );
  const record = checkedDescription(
    recordDescription,
    "Short Description in Record"
  );
  return Object.freeze({
    docDescription: normalize ? normalizeWorkbenchDescriptionTextV2(doc) : doc,
    recordDescription: normalize
      ? normalizeWorkbenchDescriptionTextV2(record)
      : record
  });
}

function withDraft(
  workingCopy: WorkbenchFormDescriptionWorkingCopyV2,
  draft: WorkbenchFormDescriptionsV2
): WorkbenchFormDescriptionWorkingCopyV2 {
  return Object.freeze({
    ...workingCopy,
    draft,
    dirty:
      draft.docDescription !== workingCopy.accepted.docDescription ||
      draft.recordDescription !== workingCopy.accepted.recordDescription
  });
}

/** Open one detached working copy from the exact current Form/session authority. */
export function createWorkbenchFormDescriptionWorkingCopyV2(
  manager: WorkbenchRevisionSessionManagerV2,
  nodeId: string
): WorkbenchFormDescriptionWorkingCopyV2 {
  const authority = manager.captureAuthority();
  const form = authority.storeSnapshot.forms.find(
    (candidate) => candidate.nodeId === nodeId
  );
  const model = authority.managerSnapshot.session.modelByNode[nodeId];
  if (!form || !model) {
    throw new Error(`Unknown Workbench nodeId: ${nodeId}`);
  }
  const accepted = descriptions(
    form.docDescription,
    form.recordDescription,
    false
  );
  return Object.freeze({
    nodeId,
    formId: model.formId,
    formVersion: model.formVersion,
    authority,
    accepted,
    draft: accepted,
    dirty: false
  });
}

/** Update either or both draft values without changing accepted Workbench state. */
export function updateWorkbenchFormDescriptionWorkingCopyV2(
  workingCopy: WorkbenchFormDescriptionWorkingCopyV2,
  changes: Partial<WorkbenchFormDescriptionsV2>
): WorkbenchFormDescriptionWorkingCopyV2 {
  const draft = descriptions(
    changes.docDescription === undefined
      ? workingCopy.draft.docDescription
      : changes.docDescription,
    changes.recordDescription === undefined
      ? workingCopy.draft.recordDescription
      : changes.recordDescription,
    true
  );
  return withDraft(workingCopy, draft);
}

/** Restore the detached draft to its accepted opening values. */
export function resetWorkbenchFormDescriptionWorkingCopyV2(
  workingCopy: WorkbenchFormDescriptionWorkingCopyV2
): WorkbenchFormDescriptionWorkingCopyV2 {
  return withDraft(workingCopy, workingCopy.accepted);
}

/** Purely replace one Form's descriptions in a detached complete Revision. */
export function updateWorkbenchFormDescriptionsInCompleteRevisionV2(
  source: DcmsCompleteRevisionPackageV2,
  nodeId: string,
  next: WorkbenchFormDescriptionsV2
): DcmsCompleteRevisionPackageV2 {
  const normalized = descriptions(
    next.docDescription,
    next.recordDescription,
    true
  );
  let found = false;
  const candidate = structuredClone(source);
  candidate.forms = candidate.forms.map((form) => {
    if (form.nodeId !== nodeId) return form;
    found = true;
    return {
      ...form,
      docDescription: normalized.docDescription,
      recordDescription: normalized.recordDescription
    };
  });
  if (!found) throw new Error(`Unknown Workbench nodeId: ${nodeId}`);
  return candidate;
}

function authorityIsCurrent(
  manager: WorkbenchRevisionSessionManagerV2,
  authority: WorkbenchRevisionSessionAuthorityV2
) {
  const current = manager.getSnapshot();
  return (
    current === authority.managerSnapshot &&
    current.session.store.getSnapshot() === authority.storeSnapshot
  );
}

function seedValuesByNode(
  authority: WorkbenchRevisionSessionAuthorityV2
): ReadonlyMap<string, ReadonlyMap<string, DcmsValue>> {
  return new Map(
    authority.managerSnapshot.session.forms.map((form) => [
      form.nodeId,
      form.seedValues
    ])
  );
}

function dirtyByNode(
  authority: WorkbenchRevisionSessionAuthorityV2,
  editedNodeId: string
): ReadonlyMap<string, boolean> {
  return new Map(
    authority.storeSnapshot.forms.map((form) => [
      form.nodeId,
      form.dirty || form.nodeId === editedNodeId
    ])
  );
}

/**
 * Confirm one description working copy through a prepared complete candidate and
 * one session compare-and-swap. Unchanged drafts close without publication.
 */
export function confirmWorkbenchFormDescriptionWorkingCopyV2(
  manager: WorkbenchRevisionSessionManagerV2,
  workingCopy: WorkbenchFormDescriptionWorkingCopyV2
): WorkbenchFormDescriptionConfirmationResultV2 {
  const current = manager.getSnapshot();
  if (!authorityIsCurrent(manager, workingCopy.authority)) {
    return Object.freeze({
      accepted: false,
      code: "DESCRIPTION_AUTHORITY_STALE" as const,
      error:
        "The working Revision changed after the Form description edit was opened.",
      snapshot: current
    });
  }

  const normalized = descriptions(
    workingCopy.draft.docDescription,
    workingCopy.draft.recordDescription,
    true
  );
  const changed =
    normalized.docDescription !== workingCopy.accepted.docDescription ||
    normalized.recordDescription !== workingCopy.accepted.recordDescription;
  if (!changed) {
    return Object.freeze({
      accepted: true,
      changed: false,
      nodeId: workingCopy.nodeId,
      descriptions: normalized,
      snapshot: current,
      notificationErrors: Object.freeze([])
    });
  }

  try {
    const source = createCompleteRevisionPackageV2FromAuthority(
      workingCopy.authority
    );
    const candidate = updateWorkbenchFormDescriptionsInCompleteRevisionV2(
      source,
      workingCopy.nodeId,
      normalized
    );
    const prepared = prepareCompleteRevisionPackageV2(candidate);
    const result = manager.replacePreparedCompleteRevision(
      prepared,
      workingCopy.authority,
      {
        seedValuesByNode: seedValuesByNode(workingCopy.authority),
        dirtyByNode: dirtyByNode(workingCopy.authority, workingCopy.nodeId)
      }
    );
    if (!result.accepted) {
      return Object.freeze({
        accepted: false,
        code:
          result.code === "SESSION_AUTHORITY_STALE"
            ? ("DESCRIPTION_AUTHORITY_STALE" as const)
            : result.code,
        error: result.error,
        snapshot: result.snapshot
      });
    }
    return Object.freeze({
      accepted: true,
      changed: true,
      nodeId: workingCopy.nodeId,
      descriptions: normalized,
      snapshot: result.snapshot,
      notificationErrors: result.notificationErrors
    });
  } catch (error) {
    return Object.freeze({
      accepted: false,
      code: "DESCRIPTION_CANDIDATE_INVALID" as const,
      error: message(error),
      snapshot: manager.getSnapshot()
    });
  }
}
