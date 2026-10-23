/**
 * Off-screen preparation for strict Workbench package v2 data.
 *
 * Preparation is intentionally separate from parsing and accepted-state
 * replacement. It proves definition/model agreement, compiles every applicable
 * Form, evaluates current and Original values, and returns a detached read-only
 * candidate without publishing to an existing Workbench store.
 */
import {
  canonicalJson,
  compileForm,
  evaluateRecord,
  getCompiledPlanCacheKey,
  type CompiledFormPlan,
  type DcmsValue,
  type FormDefinition,
  type RecordEvaluation
} from "@dcms/form-rules";
import {
  cloneFrozenGraph,
  freezeOwnedGraph,
  readonlyMapSnapshot
} from "./immutable.js";
import {
  formDefinitionFromWorkbenchModel,
  type WorkbenchFormModel
} from "./workbench-model.js";
import type {
  DcmsCompleteRevisionMetadataV2,
  DcmsCompleteRevisionPackageV2,
  DcmsRecordValuesPackageV2,
  DcmsRevisionIdentityV2
} from "./workbench-package-contracts.js";

export type WorkbenchPackagePreparationErrorCode =
  | "PREPARATION_CONTEXT_INVALID"
  | "PREPARATION_REVISION_MISMATCH"
  | "PREPARATION_NODE_NOT_FOUND"
  | "PREPARATION_FORM_MISMATCH"
  | "PREPARATION_FINGERPRINT_MISMATCH"
  | "PREPARATION_MODEL_DEFINITION_MISMATCH"
  | "PREPARATION_DEFINITION_INVALID"
  | "PREPARATION_VALUE_COVERAGE"
  | "PREPARATION_RECORD_INVALID";

/** Controlled preparation-boundary failure with a stable code and package path. */
export class WorkbenchPackagePreparationError extends Error {
  readonly code: WorkbenchPackagePreparationErrorCode;
  readonly path: string;

  constructor(
    code: WorkbenchPackagePreparationErrorCode,
    path: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkbenchPackagePreparationError";
    this.code = code;
    this.path = path;
  }
}

function fail(
  code: WorkbenchPackagePreparationErrorCode,
  path: string,
  message: string,
  options?: ErrorOptions
): never {
  throw new WorkbenchPackagePreparationError(code, path, message, options);
}

/** Minimal accepted-session authority needed to prepare a record-values package. */
export interface WorkbenchAcceptedFormDescriptionV2 {
  nodeId: string;
  definition: FormDefinition;
}

/**
 * Accepted Revision identity plus the exact currently accepted Form definitions.
 * Values and UI state are intentionally absent; preparation must not mutate them.
 */
export interface WorkbenchAcceptedSessionDescriptionV2 {
  revision: DcmsRevisionIdentityV2;
  forms: readonly WorkbenchAcceptedFormDescriptionV2[];
}

export interface PreparedWorkbenchRecordStateV2 {
  values: ReadonlyMap<string, DcmsValue>;
  evaluation: RecordEvaluation;
}

export interface WorkbenchPreparedRecordSummaryV2 {
  recordCount: number;
  canSubmitCount: number;
  blockingRecordCount: number;
  warningRecordCount: number;
  evaluationErrorRecordCount: number;
  blockingFieldCount: number;
  warningFieldCount: number;
  evaluationErrorFieldCount: number;
}

export type WorkbenchPackagePreparationDiagnosticSeverity = "warning" | "error";

export type WorkbenchPackagePreparationDiagnosticCode =
  | "CURRENT_RECORD_BLOCKING"
  | "CURRENT_RECORD_WARNING"
  | "CURRENT_RECORD_EVALUATION_ERROR"
  | "ORIGINAL_RECORD_BLOCKING"
  | "ORIGINAL_RECORD_WARNING"
  | "ORIGINAL_RECORD_EVALUATION_ERROR";

/**
 * A diagnostic describes prepared Record state; it does not mean preparation
 * failed. Runtime evaluation errors and ordinary validation failures remain
 * distinct from package/definition rejection.
 */
export interface WorkbenchPackagePreparationDiagnosticV2 {
  code: WorkbenchPackagePreparationDiagnosticCode;
  severity: WorkbenchPackagePreparationDiagnosticSeverity;
  path: string;
  nodeId: string;
  formId: string;
  fieldIds: readonly string[];
  message: string;
}

export interface WorkbenchPackagePreparationSummaryV2 {
  scope: "record-values" | "complete-revision";
  formCount: number;
  fieldCount: number;
  validationRowCount: number;
  current: WorkbenchPreparedRecordSummaryV2;
  original: WorkbenchPreparedRecordSummaryV2;
}

export interface PreparedRecordValuesEntryV2 {
  nodeId: string;
  formId: string;
  formVersion: string | number;
  definitionFingerprint: string;
  definition: FormDefinition;
  current: PreparedWorkbenchRecordStateV2;
  original: PreparedWorkbenchRecordStateV2;
}

export interface PreparedRecordValuesPackageV2 {
  scope: "record-values";
  revision: DcmsRevisionIdentityV2;
  records: readonly PreparedRecordValuesEntryV2[];
  summary: WorkbenchPackagePreparationSummaryV2;
  diagnostics: readonly WorkbenchPackagePreparationDiagnosticV2[];
}

export interface PreparedCompleteRevisionFormV2 {
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
  definitionFingerprint: string;
  current: PreparedWorkbenchRecordStateV2;
  original: PreparedWorkbenchRecordStateV2;
}

export interface PreparedCompleteRevisionPackageV2 {
  scope: "complete-revision";
  revision: DcmsCompleteRevisionMetadataV2;
  activeNodeId: string;
  forms: readonly PreparedCompleteRevisionFormV2[];
  summary: WorkbenchPackagePreparationSummaryV2;
  diagnostics: readonly WorkbenchPackagePreparationDiagnosticV2[];
}

interface MutableRecordSummary {
  recordCount: number;
  canSubmitCount: number;
  blockingRecordCount: number;
  warningRecordCount: number;
  evaluationErrorRecordCount: number;
  blockingFieldCount: number;
  warningFieldCount: number;
  evaluationErrorFieldCount: number;
}

function emptyRecordSummary(): MutableRecordSummary {
  return {
    recordCount: 0,
    canSubmitCount: 0,
    blockingRecordCount: 0,
    warningRecordCount: 0,
    evaluationErrorRecordCount: 0,
    blockingFieldCount: 0,
    warningFieldCount: 0,
    evaluationErrorFieldCount: 0
  };
}

function cloneValue(value: DcmsValue): DcmsValue {
  return Array.isArray(value) ? value.map(cloneValue) : value;
}

function preparedValueMap(
  values: Readonly<Record<string, DcmsValue>>
): ReadonlyMap<string, DcmsValue> {
  return readonlyMapSnapshot(new Map(Object.entries(values)), (value) =>
    cloneFrozenGraph(cloneValue(value))
  );
}

function sortedKeys(value: Readonly<Record<string, DcmsValue>>): string[] {
  return Object.keys(value).sort();
}

function assertExactValueCoverage(
  values: Readonly<Record<string, DcmsValue>>,
  definition: FormDefinition,
  path: string
): void {
  const expected = definition.fields.map((field) => field.id).sort();
  const actual = sortedKeys(values);
  if (
    expected.length !== actual.length ||
    expected.some((fieldId, index) => fieldId !== actual[index])
  ) {
    const missing = expected.filter((fieldId) => !actual.includes(fieldId));
    const unknown = actual.filter((fieldId) => !expected.includes(fieldId));
    const details = [
      missing.length ? `missing ${missing.join(", ")}` : "",
      unknown.length ? `unknown ${unknown.join(", ")}` : ""
    ]
      .filter(Boolean)
      .join("; ");
    fail(
      "PREPARATION_VALUE_COVERAGE",
      path,
      `${path} must contain exactly the accepted Form field IDs${details ? ` (${details})` : ""}.`
    );
  }
}

function stripSourceSpans(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripSourceSpans);
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .filter((key) => key !== "span")
      .sort()
      .map((key) => [key, stripSourceSpans(source[key])])
  );
}

function compiledDefinitionSemantics(plan: CompiledFormPlan): unknown {
  return {
    formId: plan.formId,
    version: plan.version,
    fields: plan.fieldOrder.map((fieldId) => {
      const field = plan.fields.get(fieldId)!;
      return {
        id: field.definition.id,
        label: field.definition.label,
        valueType: field.definition.valueType,
        mustBeCorrect: !!field.definition.mustBeCorrect,
        legacyFormula: field.legacyFormula
          ? stripSourceSpans(field.legacyFormula.root)
          : null,
        validationRows: field.validationRows.map((row) => ({
          id: row.definition.id,
          label: row.definition.label ?? row.definition.id,
          formula: row.formula ? stripSourceSpans(row.formula.root) : null,
          operator: row.validation.operator,
          criteria: row.validation.criteria,
          caseSensitive: row.validation.caseSensitive,
          numericKeyword: row.validation.numericKeyword ?? null,
          selectionValues: row.validation.selectionValues
            ? [...row.validation.selectionValues].sort()
            : null,
          keywordAst: row.validation.keywordAst
            ? stripSourceSpans(row.validation.keywordAst)
            : null
        }))
      };
    })
  };
}

interface PreparedDefinition {
  definition: FormDefinition;
  fingerprint: string;
  plan: CompiledFormPlan;
}

function compilePreparedDefinition(
  definition: FormDefinition,
  path: string
): CompiledFormPlan {
  try {
    return compileForm(definition);
  } catch (cause) {
    fail(
      "PREPARATION_DEFINITION_INVALID",
      path,
      `Form definition could not be compiled: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause instanceof Error ? { cause } : undefined
    );
  }
}

function prepareDefinitionFromModel(
  model: WorkbenchFormModel,
  definition: FormDefinition,
  path: string
): PreparedDefinition {
  let derived: FormDefinition;
  try {
    derived = formDefinitionFromWorkbenchModel(model);
  } catch (cause) {
    fail(
      "PREPARATION_MODEL_DEFINITION_MISMATCH",
      `${path}.model`,
      [
        "Workbench model could not produce a preferred Form definition:",
        cause instanceof Error ? cause.message : String(cause)
      ].join(" "),
      cause instanceof Error ? { cause } : undefined
    );
  }

  const derivedPlan = compilePreparedDefinition(derived, `${path}.model`);
  const packagedPlan = compilePreparedDefinition(
    definition,
    `${path}.definition`
  );
  if (
    canonicalJson(compiledDefinitionSemantics(derivedPlan)) !==
    canonicalJson(compiledDefinitionSemantics(packagedPlan))
  ) {
    fail(
      "PREPARATION_MODEL_DEFINITION_MISMATCH",
      `${path}.definition`,
      `${path}.model and ${path}.definition do not describe the same compiled Form semantics.`
    );
  }

  return {
    definition: cloneFrozenGraph(definition),
    fingerprint: getCompiledPlanCacheKey(definition),
    plan: freezeOwnedGraph(packagedPlan)
  };
}

function prepareRecordState(
  plan: CompiledFormPlan,
  definition: FormDefinition,
  values: Readonly<Record<string, DcmsValue>>,
  path: string
): PreparedWorkbenchRecordStateV2 {
  assertExactValueCoverage(values, definition, path);
  try {
    const preparedValues = preparedValueMap(values);
    const evaluation = freezeOwnedGraph(evaluateRecord(plan, preparedValues));
    return Object.freeze({ values: preparedValues, evaluation });
  } catch (cause) {
    if (cause instanceof WorkbenchPackagePreparationError) throw cause;
    fail(
      "PREPARATION_RECORD_INVALID",
      path,
      `Record values could not be evaluated: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause instanceof Error ? { cause } : undefined
    );
  }
}

function addRecordSummary(
  summary: MutableRecordSummary,
  evaluation: RecordEvaluation
): void {
  summary.recordCount += 1;
  if (evaluation.canSubmit) summary.canSubmitCount += 1;
  if (evaluation.blockingFieldIds.length) summary.blockingRecordCount += 1;
  if (evaluation.warningFieldIds.length) summary.warningRecordCount += 1;
  if (evaluation.errorFieldIds.length) summary.evaluationErrorRecordCount += 1;
  summary.blockingFieldCount += evaluation.blockingFieldIds.length;
  summary.warningFieldCount += evaluation.warningFieldIds.length;
  summary.evaluationErrorFieldCount += evaluation.errorFieldIds.length;
}

function recordDiagnostics(
  state: "current" | "original",
  path: string,
  nodeId: string,
  formId: string,
  evaluation: RecordEvaluation
): WorkbenchPackagePreparationDiagnosticV2[] {
  const prefix = state === "current" ? "CURRENT" : "ORIGINAL";
  const label = state === "current" ? "Current" : "Original";
  const diagnostics: WorkbenchPackagePreparationDiagnosticV2[] = [];
  if (evaluation.errorFieldIds.length) {
    diagnostics.push({
      code: `${prefix}_RECORD_EVALUATION_ERROR`,
      severity: "error",
      path,
      nodeId,
      formId,
      fieldIds: Object.freeze([...evaluation.errorFieldIds]),
      message: `${label} Record contains evaluation errors in ${evaluation.errorFieldIds.length} field(s).`
    });
  }
  if (evaluation.blockingFieldIds.length) {
    diagnostics.push({
      code: `${prefix}_RECORD_BLOCKING`,
      severity: "warning",
      path,
      nodeId,
      formId,
      fieldIds: Object.freeze([...evaluation.blockingFieldIds]),
      message: `${label} Record is blocked by ${evaluation.blockingFieldIds.length} field(s).`
    });
  }
  if (evaluation.warningFieldIds.length) {
    diagnostics.push({
      code: `${prefix}_RECORD_WARNING`,
      severity: "warning",
      path,
      nodeId,
      formId,
      fieldIds: Object.freeze([...evaluation.warningFieldIds]),
      message: `${label} Record contains warnings in ${evaluation.warningFieldIds.length} field(s).`
    });
  }
  return diagnostics;
}

function freezeSummary(
  scope: "record-values" | "complete-revision",
  formCount: number,
  fieldCount: number,
  validationRowCount: number,
  current: MutableRecordSummary,
  original: MutableRecordSummary
): WorkbenchPackagePreparationSummaryV2 {
  return Object.freeze({
    scope,
    formCount,
    fieldCount,
    validationRowCount,
    current: Object.freeze({ ...current }),
    original: Object.freeze({ ...original })
  });
}

function sameRevisionIdentity(
  left: DcmsRevisionIdentityV2,
  right: DcmsRevisionIdentityV2
): boolean {
  return (
    left.productId === right.productId &&
    left.revisionId === right.revisionId &&
    left.revisionLabel === right.revisionLabel &&
    left.documentId === right.documentId
  );
}

interface AcceptedPreparedForm {
  source: WorkbenchAcceptedFormDescriptionV2;
  plan: CompiledFormPlan;
}

function assertRevisionIdentity(
  revision: DcmsRevisionIdentityV2,
  path: string
): void {
  for (const key of [
    "productId",
    "revisionId",
    "revisionLabel",
    "documentId"
  ] as const) {
    if (typeof revision?.[key] !== "string" || !revision[key].trim()) {
      fail(
        "PREPARATION_CONTEXT_INVALID",
        `${path}.${key}`,
        `${path}.${key} must be nonblank text.`
      );
    }
  }
}

function acceptedFormsByNode(
  accepted: WorkbenchAcceptedSessionDescriptionV2
): Map<string, AcceptedPreparedForm> {
  assertRevisionIdentity(accepted.revision, "$accepted.revision");
  if (!Array.isArray(accepted.forms)) {
    fail(
      "PREPARATION_CONTEXT_INVALID",
      "$accepted.forms",
      "$accepted.forms must be an array."
    );
  }
  const forms = new Map<string, AcceptedPreparedForm>();
  for (let index = 0; index < accepted.forms.length; index += 1) {
    const form = accepted.forms[index];
    if (!form || typeof form.nodeId !== "string" || !form.nodeId.trim()) {
      fail(
        "PREPARATION_CONTEXT_INVALID",
        `$accepted.forms[${index}]`,
        "Accepted-session Forms require a nonblank nodeId and Form definition."
      );
    }
    if (forms.has(form.nodeId)) {
      fail(
        "PREPARATION_CONTEXT_INVALID",
        `$accepted.forms[${index}].nodeId`,
        `Accepted-session nodeId ${form.nodeId} is duplicated.`
      );
    }
    let plan: CompiledFormPlan;
    try {
      plan = freezeOwnedGraph(compileForm(form.definition));
    } catch (cause) {
      fail(
        "PREPARATION_CONTEXT_INVALID",
        `$accepted.forms[${index}].definition`,
        `Accepted-session Form definition is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause instanceof Error ? { cause } : undefined
      );
    }
    forms.set(form.nodeId, { source: form, plan });
  }
  return forms;
}

/**
 * Prepare compatible current/Original Record values against the supplied
 * accepted Revision description. No Workbench store operation is invoked.
 */
export function prepareRecordValuesPackageV2(
  packageData: DcmsRecordValuesPackageV2,
  accepted: WorkbenchAcceptedSessionDescriptionV2
): PreparedRecordValuesPackageV2 {
  const acceptedByNode = acceptedFormsByNode(accepted);
  if (!sameRevisionIdentity(packageData.revision, accepted.revision)) {
    fail(
      "PREPARATION_REVISION_MISMATCH",
      "$.revision",
      "Record-values package Revision identity does not match the accepted Revision."
    );
  }
  const currentSummary = emptyRecordSummary();
  const originalSummary = emptyRecordSummary();
  const diagnostics: WorkbenchPackagePreparationDiagnosticV2[] = [];
  let fieldCount = 0;
  let validationRowCount = 0;

  const records = packageData.records.map((record, index) => {
    const path = `$.records[${index}]`;
    const acceptedForm = acceptedByNode.get(record.nodeId);
    if (!acceptedForm) {
      fail(
        "PREPARATION_NODE_NOT_FOUND",
        `${path}.nodeId`,
        `No accepted Form node matches ${record.nodeId}.`
      );
    }
    const definition = acceptedForm.source.definition;
    if (
      record.formId !== definition.formId ||
      record.formVersion !== definition.version
    ) {
      fail(
        "PREPARATION_FORM_MISMATCH",
        path,
        [
          `${path} targets Form ${record.formId}`,
          `version ${String(record.formVersion)}, not accepted Form`,
          `${definition.formId} version ${String(definition.version)}.`
        ].join(" ")
      );
    }
    const fingerprint = getCompiledPlanCacheKey(definition);
    if (record.definitionFingerprint !== fingerprint) {
      fail(
        "PREPARATION_FINGERPRINT_MISMATCH",
        `${path}.definitionFingerprint`,
        `${path}.definitionFingerprint does not match the accepted Form definition.`
      );
    }

    const preparedDefinition = cloneFrozenGraph(definition);
    const current = prepareRecordState(
      acceptedForm.plan,
      preparedDefinition,
      record.currentValues,
      `${path}.currentValues`
    );
    const original = prepareRecordState(
      acceptedForm.plan,
      preparedDefinition,
      record.originalValues,
      `${path}.originalValues`
    );
    addRecordSummary(currentSummary, current.evaluation);
    addRecordSummary(originalSummary, original.evaluation);
    diagnostics.push(
      ...recordDiagnostics(
        "current",
        `${path}.currentValues`,
        record.nodeId,
        definition.formId,
        current.evaluation
      ),
      ...recordDiagnostics(
        "original",
        `${path}.originalValues`,
        record.nodeId,
        definition.formId,
        original.evaluation
      )
    );
    fieldCount += definition.fields.length;
    validationRowCount += definition.fields.reduce(
      (count, field) => count + (field.validationRows?.length ?? 0),
      0
    );

    return Object.freeze({
      nodeId: record.nodeId,
      formId: definition.formId,
      formVersion: definition.version,
      definitionFingerprint: fingerprint,
      definition: preparedDefinition,
      current,
      original
    });
  });

  return Object.freeze({
    scope: "record-values",
    revision: cloneFrozenGraph(packageData.revision),
    records: Object.freeze(records),
    summary: freezeSummary(
      "record-values",
      records.length,
      fieldCount,
      validationRowCount,
      currentSummary,
      originalSummary
    ),
    diagnostics: Object.freeze(diagnostics.map((item) => Object.freeze(item)))
  });
}

/**
 * Prepare a complete replacement Revision off-screen. The returned candidate is
 * detached and read-only; it is not an accepted Workbench session.
 */
export function prepareCompleteRevisionPackageV2(
  packageData: DcmsCompleteRevisionPackageV2
): PreparedCompleteRevisionPackageV2 {
  const currentSummary = emptyRecordSummary();
  const originalSummary = emptyRecordSummary();
  const diagnostics: WorkbenchPackagePreparationDiagnosticV2[] = [];
  let fieldCount = 0;
  let validationRowCount = 0;

  const forms = packageData.forms.map((form, index) => {
    const path = `$.forms[${index}]`;
    const preparedDefinition = prepareDefinitionFromModel(
      form.model,
      form.definition,
      path
    );
    const current = prepareRecordState(
      preparedDefinition.plan,
      preparedDefinition.definition,
      form.currentValues,
      `${path}.currentValues`
    );
    const original = prepareRecordState(
      preparedDefinition.plan,
      preparedDefinition.definition,
      form.originalValues,
      `${path}.originalValues`
    );
    addRecordSummary(currentSummary, current.evaluation);
    addRecordSummary(originalSummary, original.evaluation);
    diagnostics.push(
      ...recordDiagnostics(
        "current",
        `${path}.currentValues`,
        form.nodeId,
        form.definition.formId,
        current.evaluation
      ),
      ...recordDiagnostics(
        "original",
        `${path}.originalValues`,
        form.nodeId,
        form.definition.formId,
        original.evaluation
      )
    );
    fieldCount += form.definition.fields.length;
    validationRowCount += form.definition.fields.reduce(
      (count, field) => count + (field.validationRows?.length ?? 0),
      0
    );

    return Object.freeze({
      nodeId: form.nodeId,
      title: form.title,
      scenario: form.scenario,
      seed: form.seed,
      section: form.section,
      step: form.step,
      docDescription: form.docDescription,
      recordDescription: form.recordDescription,
      model: cloneFrozenGraph(form.model),
      definition: preparedDefinition.definition,
      definitionFingerprint: preparedDefinition.fingerprint,
      current,
      original
    });
  });

  return Object.freeze({
    scope: "complete-revision",
    revision: cloneFrozenGraph(packageData.revision),
    activeNodeId: packageData.activeNodeId,
    forms: Object.freeze(forms),
    summary: freezeSummary(
      "complete-revision",
      forms.length,
      fieldCount,
      validationRowCount,
      currentSummary,
      originalSummary
    ),
    diagnostics: Object.freeze(diagnostics.map((item) => Object.freeze(item)))
  });
}
