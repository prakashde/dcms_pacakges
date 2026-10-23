/**
 * Version-2 portable Workbench package contracts.
 *
 * These interfaces define the interchange vocabulary shared by the React
 * application, the strict package codec, and future host adapters. Parsing,
 * preparation, accepted-state replacement, and file handling remain separate
 * responsibilities.
 */
import type { DcmsValue, FormDefinition } from "@dcms/form-rules";
import type { WorkbenchFormModel } from "./workbench-model.js";

export const DCMS_WORKBENCH_PACKAGE_KIND = "dcms-workbench-package" as const;
export const DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION = 2 as const;
export const DCMS_WORKBENCH_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
export const DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS = 100 as const;
export const DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS = 1024 * 1024;

export type DcmsWorkbenchPackageScopeV2 = "record-values" | "complete-revision";

export interface DcmsWorkbenchPackageEnvelopeV2 {
  kind: typeof DCMS_WORKBENCH_PACKAGE_KIND;
  schemaVersion: typeof DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION;
  scope: DcmsWorkbenchPackageScopeV2;
}

/** Human-readable identity carried by either package scope. */
export interface DcmsRevisionIdentityV2 {
  productId: string;
  revisionId: string;
  revisionLabel: string;
  documentId: string;
}

/** Complete deterministic fixture identity carried only by full Revision packages. */
export interface DcmsCompleteRevisionMetadataV2 extends DcmsRevisionIdentityV2 {
  seed: string;
  profile: string;
}

/**
 * One complete current/original Record pair for an already accepted Form.
 *
 * Values are complete source-value maps. They never contain calculated row
 * values or serialized RecordEvaluation output.
 */
export interface DcmsRecordValuesEntryV2 {
  nodeId: string;
  formId: string;
  formVersion: string | number;
  definitionFingerprint: string;
  currentValues: Record<string, DcmsValue>;
  originalValues: Record<string, DcmsValue>;
}

/**
 * Narrow package scope: replace compatible current/original Record values only.
 * Form definitions, presentation models, descriptions, ordering, Revision
 * metadata, and authoring lifecycle are unchanged by this package.
 */
export interface DcmsRecordValuesPackageV2
  extends DcmsWorkbenchPackageEnvelopeV2 {
  scope: "record-values";
  revision: DcmsRevisionIdentityV2;
  records: DcmsRecordValuesEntryV2[];
}

/**
 * One complete Form Element inside a portable Revision baseline.
 *
 * `model` is the Workbench presentation source. `definition` is the accepted
 * rules-engine source. Import must verify that the preferred definition derived
 * from `model` is semantically identical to `definition` before compiling it.
 */
export interface DcmsCompleteRevisionFormV2 {
  nodeId: string;
  title: string;
  scenario: string;
  seed: string;
  section: number;
  step: number;
  docDescription: string;
  recordDescription: string;
  model: WorkbenchFormModel;
  definition: FormDefinition;
  currentValues: Record<string, DcmsValue>;
  originalValues: Record<string, DcmsValue>;
}

/**
 * Complete package scope: create and prepare a replacement Workbench Revision
 * off-screen, then replace the application session at one acceptance boundary.
 */
export interface DcmsCompleteRevisionPackageV2
  extends DcmsWorkbenchPackageEnvelopeV2 {
  scope: "complete-revision";
  revision: DcmsCompleteRevisionMetadataV2;
  activeNodeId: string;
  forms: DcmsCompleteRevisionFormV2[];
}

export type DcmsWorkbenchPackageV2 =
  | DcmsRecordValuesPackageV2
  | DcmsCompleteRevisionPackageV2;
