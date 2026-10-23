/** Typed React/application adapter for @dcms/form-rules. */
export { createFormStore, type FormStore } from "./form-store.js";
export { NumberField, type NumberFieldProps } from "./NumberField.js";
export { normalizeFiniteNumberInput } from "./normalization.js";
export { createDraftEnvelope, draftMatchesDefinition } from "./drafts.js";
export type {
  AsyncEvaluationState,
  DraftEnvelope,
  DraftSaveResult,
  RecordTransitionRequest,
  RecordTransitionResult,
  WorkbenchFieldCategory,
  WorkbenchHostServices,
  WorkbenchMode,
  WorkbenchStoreMode
} from "./contracts.js";

export {
  createWorkbenchStore,
  type DefinitionUpdateResult,
  type WorkbenchFormInput,
  type WorkbenchFormSnapshot,
  type WorkbenchSnapshot,
  type WorkbenchStore,
  type WorkbenchStoreOptions
} from "./workbench-store.js";
export { useWorkbenchNode, useWorkbenchSnapshot } from "./workbench-hooks.js";

export {
  summarizeWorkbenchFormAuthoring,
  summarizeWorkbenchRevisionAuthoring,
  type WorkbenchFormAuthoringState,
  type WorkbenchFormAuthoringStatus,
  type WorkbenchFormAuthoringSummary,
  type WorkbenchRevisionAuthoringSummary
} from "./workbench-authoring-summary.js";

export {
  createWorkbenchFormModel,
  formDefinitionFromWorkbenchModel,
  valueTypeForWorkbenchCategory,
  type WorkbenchFieldModel,
  type WorkbenchFieldPresentation,
  type WorkbenchFormModel
} from "./workbench-model.js";

export {
  ValidationRowEditor,
  type ValidationRowEditorProps
} from "./ValidationRowEditor.js";
export {
  criteriaForWorkbenchCategory,
  criterionAllowedForWorkbenchCategory,
  getValidationRowDiagnostics,
  nextValidationRowId,
  normalizeValidationRowsForCategory,
  summarizeValidationRows,
  type CriteriaOption,
  type ValidationRowDiagnostics
} from "./validation-editor.js";

export {
  FormEditor,
  type FormEditorAcceptedFieldContext,
  type FormEditorAcceptedFieldState,
  type FormEditorProps
} from "./FormEditor.js";
export {
  FormDescriptionEditor,
  type FormDescriptionEditorProps
} from "./FormDescriptionEditor.js";
export {
  addWorkbenchField,
  applyWorkbenchFieldCategory,
  cloneWorkbenchField,
  cloneWorkbenchFormModel,
  defaultWorkbenchField,
  deleteWorkbenchField,
  nextWorkbenchFieldId,
  reorderWorkbenchField,
  replaceWorkbenchField
} from "./form-editor.js";

export {
  FieldFeedback,
  RecordField,
  RecordForm,
  type FieldFeedbackProps,
  type RecordFieldProps,
  type RecordFormProps
} from "./RecordForm.js";
export {
  RevisionOverview,
  type RevisionOverviewProps
} from "./RevisionOverview.js";

export {
  createAsyncEvaluationController,
  type AsyncEvaluationController,
  type AsyncEvaluationOutcome,
  type AsyncEvaluationSnapshot
} from "./async-evaluation.js";

export {
  createAsyncHostActionController,
  type AsyncHostActionController,
  type AsyncHostActionOutcome,
  type AsyncHostActionSnapshot,
  type AsyncHostActionState
} from "./async-action.js";

export {
  AsyncHostActionStatus,
  useAsyncHostAction,
  type AsyncHostActionStatusProps
} from "./async-action-react.js";
export {
  WORKBENCH_MODES,
  createWorkbenchShell,
  type WorkbenchNode,
  type WorkbenchShell,
  type WorkbenchShellMode,
  type WorkbenchShellSnapshot
} from "./workbench-shell.js";

export {
  DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
  DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
  DCMS_WORKBENCH_PACKAGE_KIND,
  DCMS_WORKBENCH_PACKAGE_MAX_BYTES,
  DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
  type DcmsCompleteRevisionFormV2,
  type DcmsCompleteRevisionMetadataV2,
  type DcmsCompleteRevisionPackageV2,
  type DcmsRecordValuesEntryV2,
  type DcmsRecordValuesPackageV2,
  type DcmsRevisionIdentityV2,
  type DcmsWorkbenchPackageEnvelopeV2,
  type DcmsWorkbenchPackageScopeV2,
  type DcmsWorkbenchPackageV2
} from "./workbench-package-contracts.js";

export {
  WorkbenchPackageError,
  convertCompleteRevisionV2ToLegacyWorkbenchSeedV1,
  convertLegacyWorkbenchSeedV1ToCompleteRevisionV2,
  parseCompleteRevisionPackageV2,
  parseLegacyWorkbenchSeedV1,
  parseRecordValuesPackageV2,
  parseWorkbenchPackageV2,
  serializeCompleteRevisionPackageV2,
  serializeLegacyWorkbenchSeedV1,
  serializeRecordValuesPackageV2,
  serializeWorkbenchPackageV2,
  type LegacyWorkbenchFieldV1,
  type LegacyWorkbenchNodeV1,
  type LegacyWorkbenchSeedV1,
  type LegacyWorkbenchSeedV1ExportOptions,
  type WorkbenchPackageErrorCode
} from "./workbench-package-codec.js";

export {
  WorkbenchPackagePreparationError,
  prepareCompleteRevisionPackageV2,
  prepareRecordValuesPackageV2,
  type PreparedCompleteRevisionFormV2,
  type PreparedCompleteRevisionPackageV2,
  type PreparedRecordValuesEntryV2,
  type PreparedRecordValuesPackageV2,
  type PreparedWorkbenchRecordStateV2,
  type WorkbenchAcceptedFormDescriptionV2,
  type WorkbenchAcceptedSessionDescriptionV2,
  type WorkbenchPackagePreparationDiagnosticCode,
  type WorkbenchPackagePreparationDiagnosticSeverity,
  type WorkbenchPackagePreparationDiagnosticV2,
  type WorkbenchPackagePreparationErrorCode,
  type WorkbenchPackagePreparationSummaryV2,
  type WorkbenchPreparedRecordSummaryV2
} from "./workbench-package-preparation.js";

export {
  ORIGINAL_WORKBENCH_SEED_V1_FORMAT,
  confirmOriginalWorkbenchSeedV1Import,
  createOriginalWorkbenchSeedV1Export,
  createOriginalWorkbenchSeedV1ImportProposal,
  originalWorkbenchSeedFilenameV1,
  type OriginalWorkbenchSeedV1Export,
  type OriginalWorkbenchSeedV1ImportProposal,
  type OriginalWorkbenchSeedV1ImportSummary
} from "./workbench-legacy-seed-v1-transfer.js";

export {
  confirmWorkbenchRecordValuesImportV2,
  createCompleteRevisionPackageV2FromAuthority,
  createRecordValuesPackageV2FromAuthority,
  createWorkbenchRecordValuesImportProposalV2,
  workbenchPackageFilenameV2,
  type WorkbenchRecordValuesImportProposalV2,
  type WorkbenchRecordValuesImportResultV2,
  type WorkbenchRecordValuesImportSummaryV2
} from "./workbench-package-transfer.js";

export {
  confirmWorkbenchCompleteRevisionReplacementV2,
  createWorkbenchCompleteRevisionReplacementProposalFromAuthorityV2,
  createWorkbenchCompleteRevisionReplacementProposalV2,
  type WorkbenchCompleteRevisionReplacementPolicyErrorCode,
  type WorkbenchCompleteRevisionReplacementPolicyResultV2,
  type WorkbenchCompleteRevisionReplacementProposalV2,
  type WorkbenchCompleteRevisionReplacementSummaryV2,
  type WorkbenchUnsavedFormSummaryV2
} from "./workbench-revision-replacement-policy.js";

export {
  createWorkbenchRevisionSessionManagerV2,
  createWorkbenchRevisionSessionV2,
  type WorkbenchRevisionSessionAuthorityV2,
  type WorkbenchRevisionSessionConstructionOptionsV2,
  type WorkbenchRevisionSessionFormV2,
  type WorkbenchRevisionSessionManagerSnapshotV2,
  type WorkbenchRevisionSessionManagerV2,
  type WorkbenchRevisionSessionReplacementErrorCode,
  type WorkbenchRevisionSessionReplacementResultV2,
  type WorkbenchRevisionSessionV2
} from "./workbench-revision-session.js";

export {
  confirmWorkbenchFormDescriptionWorkingCopyV2,
  createWorkbenchFormDescriptionWorkingCopyV2,
  normalizeWorkbenchDescriptionTextV2,
  resetWorkbenchFormDescriptionWorkingCopyV2,
  updateWorkbenchFormDescriptionWorkingCopyV2,
  updateWorkbenchFormDescriptionsInCompleteRevisionV2,
  type WorkbenchFormDescriptionConfirmationErrorCodeV2,
  type WorkbenchFormDescriptionConfirmationResultV2,
  type WorkbenchFormDescriptionsV2,
  type WorkbenchFormDescriptionWorkingCopyV2
} from "./workbench-description-authoring.js";

export {
  addWorkbenchFormNodeToCompleteRevisionV2,
  confirmWorkbenchFormNodeStructureProposalV2,
  createDefaultWorkbenchFormNodeV2,
  createWorkbenchAddFormNodeProposalV2,
  createWorkbenchDeleteFormNodeProposalV2,
  deleteWorkbenchFormNodeFromCompleteRevisionV2,
  nextWorkbenchFormNodeIdentityV2,
  type WorkbenchAddFormNodeCandidateV2,
  type WorkbenchAddFormNodeSummaryV2,
  type WorkbenchDefaultFormNodeOptionsV2,
  type WorkbenchDeleteFormNodeCandidateV2,
  type WorkbenchDeleteFormNodeSummaryV2,
  type WorkbenchFormNodeIdentityV2,
  type WorkbenchFormNodeStructureProposalV2,
  type WorkbenchFormNodeStructureSummaryV2
} from "./workbench-revision-structure.js";

export {
  WORKBENCH_RECORD_PRESET_KINDS,
  WORKBENCH_RECORD_PRESET_SCOPES,
  confirmWorkbenchRecordPresetProposalV2,
  createWorkbenchRecordPresetProposalFromAuthorityV2,
  createWorkbenchRecordPresetProposalV2,
  type WorkbenchRecordPresetConfirmationErrorCodeV2,
  type WorkbenchRecordPresetConfirmationResultV2,
  type WorkbenchRecordPresetFormSummaryV2,
  type WorkbenchRecordPresetKindV2,
  type WorkbenchRecordPresetProposalV2,
  type WorkbenchRecordPresetScopeV2,
  type WorkbenchRecordPresetSummaryV2,
  type WorkbenchRecordPresetUnavailableFormV2
} from "./workbench-record-presets.js";

export {
  WORKBENCH_EXTERNAL_INTEGRITY_POLICY_V2,
  createWorkbenchCompatibilityIdentityV2,
  type WorkbenchCompatibilityIdentityV2
} from "./workbench-compatibility-identity.js";

export * from "./seed-tools.js";
export * from "./draft-storage.js";
export * from "./rich-text.js";
export * from "./guidance.js";
