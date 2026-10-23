import type { DcmsValue, FormDefinition } from "@dcms/form-rules";

export type WorkbenchFieldCategory =
  | "Radio"
  | "Number"
  | "Text"
  | "Rich Text"
  | "Checkbox";

export type WorkbenchStoreMode = "editor" | "preview" | "revision";
/** @deprecated Use WorkbenchStoreMode for createWorkbenchStore state. */
export type WorkbenchMode = WorkbenchStoreMode;
export type AsyncEvaluationState = "idle" | "pending" | "ready" | "error";

export interface DraftEnvelope {
  schemaVersion: 1;
  formId: string;
  formVersion: string | number;
  definitionFingerprint: string;
  values: Record<string, DcmsValue>;
}

export interface DraftSaveResult {
  acknowledged: boolean;
  revisionToken?: string;
}

export interface RecordTransitionRequest {
  formId: string;
  formVersion: string | number;
  values: Record<string, DcmsValue>;
  transition: "save_draft" | "submit";
}

export interface RecordTransitionResult {
  accepted: boolean;
  revisionToken?: string;
  message?: string;
}

/**
 * Operations the React/Workbench layer may ask the host application to perform.
 *
 * DCMS supplies the real implementations. This package deliberately does not
 * choose HTTP routes, authentication, database tables, retry policy, offline
 * synchronization, or transaction/audit behavior.
 */
export interface WorkbenchHostServices {
  loadDefinition?(
    formId: string,
    version?: string | number
  ): Promise<FormDefinition>;
  saveDraft?(draft: DraftEnvelope): Promise<DraftSaveResult>;
  transitionRecord?(
    request: RecordTransitionRequest
  ): Promise<RecordTransitionResult>;
}
