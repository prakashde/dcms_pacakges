/**
 * Pure Form-node construction and Revision-structure transformations.
 *
 * This module owns portable candidate data only. It never mutates the accepted
 * Workbench store. Preparation and compare-and-swap acceptance remain separate
 * boundaries so structural authoring cannot publish a partial Revision.
 */
import type { DcmsValue } from "@dcms/form-rules";
import { cloneFrozenGraph } from "./immutable.js";
import { defaultWorkbenchField } from "./form-editor.js";
import {
  formDefinitionFromWorkbenchModel,
  type WorkbenchFormModel
} from "./workbench-model.js";
import {
  DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
  DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
  type DcmsCompleteRevisionFormV2,
  type DcmsCompleteRevisionPackageV2
} from "./workbench-package-contracts.js";
import { prepareCompleteRevisionPackageV2 } from "./workbench-package-preparation.js";
import {
  confirmWorkbenchCompleteRevisionReplacementV2,
  createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2,
  type WorkbenchCompleteRevisionReplacementPolicyResultV2,
  type WorkbenchCompleteRevisionReplacementProposalV2
} from "./workbench-revision-replacement-policy.js";
import { createCompleteRevisionPackageV2FromAuthority } from "./workbench-package-transfer.js";
import type {
  WorkbenchRevisionSessionAuthorityV2,
  WorkbenchRevisionSessionManagerV2
} from "./workbench-revision-session.js";

const NEW_NODE_PREFIX = "form-node-";
const NEW_FORM_PREFIX = "form-";
const MAX_GENERATED_ID_ATTEMPTS = 10_000;
const MAX_TITLE_LENGTH = 4096;

/** Stable paired identities selected from the currently packaged Revision. */
export interface WorkbenchFormNodeIdentityV2 {
  readonly ordinal: number;
  readonly nodeId: string;
  readonly formId: string;
}

/** Optional author-entered presentation for a newly constructed Form node. */
export interface WorkbenchDefaultFormNodeOptionsV2 {
  readonly title?: string;
  readonly docDescription?: string;
  readonly recordDescription?: string;
}

function serial(ordinal: number): string {
  return String(ordinal).padStart(2, "0");
}

function titleForNewForm(value: string | undefined, ordinal: number): string {
  if (value !== undefined && typeof value !== "string") {
    throw new Error("New Form Element title must be a string.");
  }
  const title = value?.trim() || `New Form Element ${ordinal}`;
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(
      `New Form Element title must contain at most ${MAX_TITLE_LENGTH} characters.`
    );
  }
  return title;
}

function initialValueForDefaultField(): DcmsValue {
  return "";
}

function descriptionForNewForm(
  value: string | undefined,
  label: string
): string {
  if (value === undefined) return "";
  if (
    typeof value !== "string" ||
    value.length > DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS
  ) {
    throw new Error(
      `${label} must be a string of at most ${DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS} characters.`
    );
  }
  return value;
}

/**
 * Select the first paired generated node/Form identity unused by the current
 * Revision. Repeated calls with equal input return equal identities.
 */
export function nextWorkbenchFormNodeIdentityV2(
  forms: readonly DcmsCompleteRevisionFormV2[]
): WorkbenchFormNodeIdentityV2 {
  const nodeIds = new Set(forms.map((form) => form.nodeId));
  const formIds = new Set(forms.map((form) => form.model.formId));

  for (let ordinal = 1; ordinal <= MAX_GENERATED_ID_ATTEMPTS; ordinal += 1) {
    const suffix = serial(ordinal);
    const nodeId = `${NEW_NODE_PREFIX}${suffix}`;
    const formId = `${NEW_FORM_PREFIX}${suffix}`;
    if (!nodeIds.has(nodeId) && !formIds.has(formId)) {
      return Object.freeze({ ordinal, nodeId, formId });
    }
  }

  throw new Error(
    "Unable to allocate a unique generated Form-node and Form identity."
  );
}

/**
 * Construct one detached, engine-valid default Form node. The caller may append
 * it to a complete-Revision candidate and run strict package preparation before
 * proposing replacement of the accepted session.
 */
export function createDefaultWorkbenchFormNodeV2(
  forms: readonly DcmsCompleteRevisionFormV2[],
  options: WorkbenchDefaultFormNodeOptionsV2 = {}
): DcmsCompleteRevisionFormV2 {
  const identity = nextWorkbenchFormNodeIdentityV2(forms);
  const field = defaultWorkbenchField([]);
  const model: WorkbenchFormModel = {
    schemaVersion: 1,
    formId: identity.formId,
    formVersion: 1,
    fields: [field]
  };
  const definition = formDefinitionFromWorkbenchModel(model);
  const initialValue = initialValueForDefaultField();
  const section =
    forms.reduce((maximum, form) => Math.max(maximum, form.section), 0) + 1;

  return {
    nodeId: identity.nodeId,
    title: titleForNewForm(options.title, identity.ordinal),
    scenario: "authoring",
    seed: identity.nodeId,
    section,
    step: 1,
    docDescription: descriptionForNewForm(
      options.docDescription,
      "Document description"
    ),
    recordDescription: descriptionForNewForm(
      options.recordDescription,
      "Record description"
    ),
    model,
    definition,
    currentValues: { [field.id]: initialValue },
    originalValues: { [field.id]: initialValue }
  };
}

export interface WorkbenchAddFormNodeCandidateV2 {
  readonly revision: DcmsCompleteRevisionPackageV2;
  readonly addedForm: DcmsCompleteRevisionFormV2;
}

export interface WorkbenchDeleteFormNodeCandidateV2 {
  readonly revision: DcmsCompleteRevisionPackageV2;
  readonly deletedForm: DcmsCompleteRevisionFormV2;
  readonly deletedIndex: number;
  readonly nextActiveNodeId: string;
}

export interface WorkbenchAddFormNodeSummaryV2 {
  readonly operation: "add";
  readonly nodeId: string;
  readonly formId: string;
  readonly title: string;
  readonly previousFormCount: number;
  readonly candidateFormCount: number;
  readonly nextActiveNodeId: string;
  readonly fieldCount: number;
  readonly validationRowCount: number;
}

export interface WorkbenchDeleteFormNodeSummaryV2 {
  readonly operation: "delete";
  readonly nodeId: string;
  readonly formId: string;
  readonly title: string;
  readonly previousFormCount: number;
  readonly candidateFormCount: number;
  readonly nextActiveNodeId: string;
  readonly fieldCount: number;
  readonly validationRowCount: number;
}

export type WorkbenchFormNodeStructureSummaryV2 =
  | WorkbenchAddFormNodeSummaryV2
  | WorkbenchDeleteFormNodeSummaryV2;

export interface WorkbenchFormNodeStructureProposalV2 {
  readonly operation: WorkbenchFormNodeStructureSummaryV2["operation"];
  readonly summary: WorkbenchFormNodeStructureSummaryV2;
  readonly replacement: WorkbenchCompleteRevisionReplacementProposalV2;
  readonly seedValuesByNode: ReadonlyMap<
    string,
    ReadonlyMap<string, DcmsValue>
  >;
}

function validationRowCount(form: DcmsCompleteRevisionFormV2): number {
  return form.model.fields.reduce(
    (count, field) => count + field.validationRows.length,
    0
  );
}

/** Append one detached default Form and select it in the candidate Revision. */
export function addWorkbenchFormNodeToCompleteRevisionV2(
  source: DcmsCompleteRevisionPackageV2,
  options: WorkbenchDefaultFormNodeOptionsV2 = {}
): WorkbenchAddFormNodeCandidateV2 {
  if (source.forms.length >= DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS) {
    throw new Error(
      `A complete Workbench Revision supports at most ${DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS} Form nodes.`
    );
  }

  const forms = structuredClone(source.forms);
  const addedForm = createDefaultWorkbenchFormNodeV2(forms, options);
  const revision: DcmsCompleteRevisionPackageV2 = {
    ...structuredClone(source),
    activeNodeId: addedForm.nodeId,
    forms: [...forms, structuredClone(addedForm)]
  };
  return Object.freeze({ revision, addedForm: structuredClone(addedForm) });
}

/**
 * Remove one Form from a detached candidate. The last Form is protected and an
 * active deletion selects the nearest surviving node by original order.
 */
export function deleteWorkbenchFormNodeFromCompleteRevisionV2(
  source: DcmsCompleteRevisionPackageV2,
  nodeId: string
): WorkbenchDeleteFormNodeCandidateV2 {
  const deletedIndex = source.forms.findIndex((form) => form.nodeId === nodeId);
  if (deletedIndex < 0) {
    throw new Error(`Unknown Workbench Form node: ${nodeId}`);
  }
  if (source.forms.length <= 1) {
    throw new Error("The Workbench keeps at least one Form node.");
  }

  const deletedForm = structuredClone(source.forms[deletedIndex]!);
  const forms = structuredClone(source.forms).filter(
    (form) => form.nodeId !== nodeId
  );
  const nextActiveNodeId =
    source.activeNodeId === nodeId
      ? forms[Math.min(deletedIndex, forms.length - 1)]!.nodeId
      : source.activeNodeId;
  const revision: DcmsCompleteRevisionPackageV2 = {
    ...structuredClone(source),
    activeNodeId: nextActiveNodeId,
    forms
  };

  return Object.freeze({
    revision,
    deletedForm,
    deletedIndex,
    nextActiveNodeId
  });
}

function candidateSeedValues(
  authority: WorkbenchRevisionSessionAuthorityV2,
  prepared: ReturnType<typeof prepareCompleteRevisionPackageV2>
): ReadonlyMap<string, ReadonlyMap<string, DcmsValue>> {
  return cloneFrozenGraph(
    new Map(
      prepared.forms.map((form) => [
        form.nodeId,
        authority.managerSnapshot.session.formByNode[form.nodeId]?.seedValues ??
          form.current.values
      ])
    )
  );
}

function proposal(
  authority: WorkbenchRevisionSessionAuthorityV2,
  revision: DcmsCompleteRevisionPackageV2,
  summary: WorkbenchFormNodeStructureSummaryV2
): WorkbenchFormNodeStructureProposalV2 {
  const prepared = prepareCompleteRevisionPackageV2(revision);
  return Object.freeze({
    operation: summary.operation,
    summary: Object.freeze(summary),
    replacement:
      createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2(
        authority,
        prepared
      ),
    seedValuesByNode: candidateSeedValues(authority, prepared)
  });
}

/** Prepare and summarize one Form-node addition without publishing it. */
export function createWorkbenchAddFormNodeProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  options: WorkbenchDefaultFormNodeOptionsV2 = {}
): WorkbenchFormNodeStructureProposalV2 {
  const authority = manager.captureAuthority();
  const current = createCompleteRevisionPackageV2FromAuthority(authority);
  const candidate = addWorkbenchFormNodeToCompleteRevisionV2(current, options);
  const form = candidate.addedForm;
  return proposal(authority, candidate.revision, {
    operation: "add",
    nodeId: form.nodeId,
    formId: form.model.formId,
    title: form.title,
    previousFormCount: current.forms.length,
    candidateFormCount: candidate.revision.forms.length,
    nextActiveNodeId: candidate.revision.activeNodeId,
    fieldCount: form.model.fields.length,
    validationRowCount: validationRowCount(form)
  });
}

/** Prepare and summarize one Form-node deletion without publishing it. */
export function createWorkbenchDeleteFormNodeProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  nodeId: string
): WorkbenchFormNodeStructureProposalV2 {
  const authority = manager.captureAuthority();
  const current = createCompleteRevisionPackageV2FromAuthority(authority);
  const candidate = deleteWorkbenchFormNodeFromCompleteRevisionV2(
    current,
    nodeId
  );
  const form = candidate.deletedForm;
  return proposal(authority, candidate.revision, {
    operation: "delete",
    nodeId: form.nodeId,
    formId: form.model.formId,
    title: form.title,
    previousFormCount: current.forms.length,
    candidateFormCount: candidate.revision.forms.length,
    nextActiveNodeId: candidate.nextActiveNodeId,
    fieldCount: form.model.fields.length,
    validationRowCount: validationRowCount(form)
  });
}

/** Confirm one prepared structure proposal through the established atomic policy. */
export function confirmWorkbenchFormNodeStructureProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  structureProposal: WorkbenchFormNodeStructureProposalV2,
  options: { readonly confirmDiscardUnsaved: boolean }
): WorkbenchCompleteRevisionReplacementPolicyResultV2 {
  return confirmWorkbenchCompleteRevisionReplacementV2(
    manager,
    structureProposal.replacement,
    {
      ...options,
      sessionOptions: {
        seedValuesByNode: structureProposal.seedValuesByNode
      }
    }
  );
}
