/**
 * JSON-safe API boundary for Form and Revision evaluation.
 *
 * Why this exists: Maps and internal objects are efficient in-process, while HTTP/storage boundaries need plain JSON
 * plus authoritative Form/Revision identity checks. The adapter prevents clients from submitting stale identities or
 * browser-calculated values as authority.
 */
import type {
  CompiledFormPlan,
  DcmsValue,
  RecordEvaluation,
  RecordEvaluationJson,
  RecordValuesPayload,
  CompiledRevisionPlan,
  RevisionEvaluation,
  RevisionEvaluationJson,
  RevisionRecordValuesPayload
} from "./types.js";
import {
  requireObject,
  requireKeys,
  requireId,
  requireVersion,
  assertDcmsValue,
  valueBudget
} from "./boundaries.js";
import { DcmsRuleError } from "./errors.js";
import { evaluateRecord } from "./compile.js";
import { evaluateRevision } from "./revision.js";

function copyValueRecord(
  values: Record<string, DcmsValue> | undefined
): Map<string, DcmsValue> {
  const out = new Map<string, DcmsValue>();
  if (values === undefined) return out;
  requireObject(values, "values");
  const budget = valueBudget();
  for (const [key, value] of Object.entries(values)) {
    requireId(key, "value key");
    assertDcmsValue(value, `values.${key}`, budget);
    out.set(key, value);
  }
  return out;
}

/** Validate a JSON value dictionary and copy entries into a Map; nested arrays are not cloned here. */
export function recordValuesToMap(
  values: Record<string, DcmsValue>
): Map<string, DcmsValue> {
  requireObject(values, "values");
  return copyValueRecord(values);
}

/** Validate trusted external values and copy entries; undefined becomes an empty Map. */
export function externalReferencesToMap(
  values?: Record<string, DcmsValue>
): Map<string, DcmsValue> {
  return copyValueRecord(values);
}

/**
 * Build a JSON-safe dictionary using a null prototype, preserving keys such as __proto__.
 * Field result objects are shared, not deeply cloned; treat the serialized result as read-only.
 */
export function serializeRecordEvaluation(
  result: RecordEvaluation
): RecordEvaluationJson {
  const fields: Record<string, RecordEvaluationJson["fields"][string]> =
    Object.create(null);
  for (const [fieldId, value] of result.values) fields[fieldId] = value;
  return {
    canSave: result.canSave,
    canSubmit: result.canSubmit,
    blockingFieldIds: [...result.blockingFieldIds],
    invalidFieldIds: [...result.invalidFieldIds],
    warningFieldIds: [...result.warningFieldIds],
    validFieldIds: [...result.validFieldIds],
    unvalidatedFieldIds: [...result.unvalidatedFieldIds],
    errorFieldIds: [...result.errorFieldIds],
    fields
  };
}

/**
 * Express/API convenience entry point. The authoritative Form definition is still compiled separately.
 * Payload formId/version are checked; numeric/string versions compare by their string form.
 * externalReferences must come from trusted server code. The Express example rejects that
 * property on browser requests and loads approved references inside its transaction.
 */
export function evaluateRecordPayload(
  plan: CompiledFormPlan,
  payload: RecordValuesPayload
): RecordEvaluationJson {
  requireObject(payload, "Record payload");
  requireKeys(
    payload,
    ["formId", "formVersion", "values", "externalReferences"],
    "Record payload"
  );
  requireId(payload.formId, "formId");
  requireVersion(payload.formVersion, "formVersion");
  if (
    payload.formId !== plan.formId ||
    String(payload.formVersion) !== String(plan.version)
  ) {
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `Record payload targets Form ${payload.formId} version ${payload.formVersion}, but the compiled plan is ${plan.formId} version ${plan.version}.`
    );
  }
  const entered = recordValuesToMap(payload.values);
  const externalReferences = externalReferencesToMap(
    payload.externalReferences
  );
  return serializeRecordEvaluation(
    evaluateRecord(plan, entered, { externalReferences })
  );
}

/** Convert the internal Map-based Revision result to a JSON-safe object. */
export function serializeRevisionEvaluation(
  result: RevisionEvaluation
): RevisionEvaluationJson {
  const formElements: RevisionEvaluationJson["formElements"] =
    Object.create(null);
  for (const [nodeId, value] of result.formElements) {
    formElements[nodeId] = {
      nodeId: value.nodeId,
      formId: value.formId,
      validationState: value.validationState,
      evaluationState: value.evaluationState,
      evaluation: serializeRecordEvaluation(value.evaluation)
    };
  }
  return {
    canSubmit: result.canSubmit,
    validNodeIds: [...result.validNodeIds],
    unvalidatedNodeIds: [...result.unvalidatedNodeIds],
    warningNodeIds: [...result.warningNodeIds],
    blockingNodeIds: [...result.blockingNodeIds],
    errorNodeIds: [...result.errorNodeIds],
    formElements
  };
}

/**
 * Authoritative JSON/API boundary for whole-Revision review/Submit. Every compiled Form Element
 * must have a matching node payload; extra/unknown nodes and Form identity/version mismatches are rejected.
 * Per-node externalReferences are a trusted-caller facility, not browser-supplied authority.
 */
export function evaluateRevisionPayload(
  plan: CompiledRevisionPlan,
  payload: RevisionRecordValuesPayload
): RevisionEvaluationJson {
  requireObject(payload, "Revision payload");
  requireKeys(
    payload,
    ["revisionId", "revisionVersion", "formElements"],
    "Revision payload"
  );
  requireId(payload.revisionId, "revisionId");
  requireVersion(payload.revisionVersion, "revisionVersion");
  requireObject(payload.formElements, "formElements");
  if (
    payload.revisionId !== plan.revisionId ||
    String(payload.revisionVersion) !== String(plan.version)
  ) {
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `Revision payload targets ${payload.revisionId} version ${payload.revisionVersion}, but the compiled plan is ${plan.revisionId} version ${plan.version}.`
    );
  }

  const knownNodes = new Set(plan.nodeOrder);
  for (const nodeId of Object.keys(payload.formElements)) {
    if (!knownNodes.has(nodeId)) {
      throw new DcmsRuleError(
        "FORMULA_COMPATIBILITY",
        `Revision payload contains unknown Form Element node ${nodeId}.`
      );
    }
  }

  const enteredByNode = new Map<string, ReadonlyMap<string, DcmsValue>>();
  const externalReferencesByNode = new Map<
    string,
    ReadonlyMap<string, DcmsValue>
  >();
  for (const nodeId of plan.nodeOrder) {
    const element = plan.formElements.get(nodeId)!;
    const nodePayload = Object.prototype.hasOwnProperty.call(
      payload.formElements,
      nodeId
    )
      ? payload.formElements[nodeId]
      : undefined;
    if (!nodePayload) {
      throw new DcmsRuleError(
        "FORMULA_COMPATIBILITY",
        `Revision payload is missing Form Element node ${nodeId}.`
      );
    }
    requireObject(nodePayload, `Node ${nodeId}`);
    requireKeys(
      nodePayload,
      ["formId", "formVersion", "values", "externalReferences"],
      `Node ${nodeId}`
    );
    requireId(nodePayload.formId, "formId");
    requireVersion(nodePayload.formVersion, "formVersion");
    if (
      nodePayload.formId !== element.plan.formId ||
      String(nodePayload.formVersion) !== String(element.plan.version)
    ) {
      throw new DcmsRuleError(
        "FORMULA_COMPATIBILITY",
        `Revision node ${nodeId} targets Form ${nodePayload.formId} version ${nodePayload.formVersion}, but the compiled node is ${element.plan.formId} version ${element.plan.version}.`
      );
    }
    enteredByNode.set(nodeId, recordValuesToMap(nodePayload.values));
    externalReferencesByNode.set(
      nodeId,
      externalReferencesToMap(nodePayload.externalReferences)
    );
  }

  return serializeRevisionEvaluation(
    evaluateRevision(plan, enteredByNode, { externalReferencesByNode })
  );
}
