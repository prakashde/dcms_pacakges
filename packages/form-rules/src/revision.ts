/**
 * Revision-level aggregation over independently compiled Form Elements.
 *
 * Why this is thin: Revision workflow needs one Submit decision without turning separate Form Nodes into one giant
 * dependency graph. Each Form retains its own field scope; the Revision layer only aggregates results and routes the
 * changed node to its existing Form plan.
 */
import type {
  CompiledRevisionFormElement,
  CompiledRevisionPlan,
  DcmsValue,
  FieldValidationState,
  EvaluationState,
  RevisionChangeEvaluation,
  RevisionDefinition,
  RevisionDefinitionIssue,
  RevisionEvaluation,
  RevisionEvaluationOptions,
  RevisionFormElementEvaluation
} from "./types.js";
import { assertRevisionShape, frozenSnapshot } from "./boundaries.js";
import { DcmsRuleError } from "./errors.js";
import {
  isRecordEvaluationCurrent,
  assertCompiledPlanCompatible,
  compileForm,
  evaluateChangeDetailed,
  evaluateRecord,
  getCompiledPlanCacheKey
} from "./compile.js";
import { validateFormDefinition } from "./definition-validation.js";
import { canonicalJson, compatibilityHash64 } from "./compatibility.js";

/**
 * Hash the complete canonical Revision definition for cache identity; not a cryptographic authenticity check.
 */
export function revisionDefinitionSourceHash(
  definition: RevisionDefinition
): string {
  return compatibilityHash64(canonicalJson(definition));
}

/** Cache identity includes complete Revision content plus each Form plan's engine compatibility identity. */
export function getCompiledRevisionCacheKey(
  definition: RevisionDefinition
): string {
  const childKeys = definition.formElements.map(
    (element) => `${element.nodeId}=${getCompiledPlanCacheKey(element.form)}`
  );
  const childFingerprint = compatibilityHash64(childKeys.join("|"));
  return `${definition.revisionId}:${definition.version}:source-${revisionDefinitionSourceHash(definition)}:forms-${childFingerprint}`;
}

/**
 * Collect Revision shape/identity issues and each Form's authoring issues, preserving node/field context.
 */
export function validateRevisionDefinition(
  definition: RevisionDefinition
): RevisionDefinitionIssue[] {
  const issues: RevisionDefinitionIssue[] = [];
  try {
    assertRevisionShape(definition);
  } catch (e) {
    return [
      {
        code: "REVISION-SHAPE",
        severity: "error",
        message: e instanceof Error ? e.message : String(e)
      }
    ];
  }
  if (!definition.revisionId?.trim()) {
    issues.push({
      code: "REVISION-ID-MISSING",
      severity: "error",
      message: "Revision ID is required."
    });
  }
  if (
    !Array.isArray(definition.formElements) ||
    definition.formElements.length === 0
  ) {
    issues.push({
      code: "REVISION-FORMS-EMPTY",
      severity: "error",
      message: "Revision must contain at least one Form Element."
    });
    return issues;
  }
  const nodeIds = new Set<string>();
  for (const element of definition.formElements ?? []) {
    if (!element.nodeId?.trim()) {
      issues.push({
        code: "NODE-ID-MISSING",
        severity: "error",
        message: "Form Element node ID is required."
      });
      continue;
    }
    if (nodeIds.has(element.nodeId)) {
      issues.push({
        nodeId: element.nodeId,
        code: "NODE-ID-DUP",
        severity: "error",
        message: `Duplicate Form Element node ID ${element.nodeId}.`
      });
    }
    nodeIds.add(element.nodeId);
    for (const issue of validateFormDefinition(element.form)) {
      issues.push({
        nodeId: element.nodeId,
        fieldId: issue.fieldId,
        code: issue.code,
        severity: issue.severity,
        message: issue.message
      });
    }
  }
  return issues;
}

/**
 * Check every contained Form plan against this engine; this is not a validation of arbitrary plan objects.
 */
export function assertCompiledRevisionCompatible(
  plan: CompiledRevisionPlan
): void {
  for (const element of plan.formElements.values())
    assertCompiledPlanCompatible(element.plan);
}

/**
 * Compile a Revision as a thin collection of independent Form plans. No cross-Form FIELD() graph is
 * invented; each Form remains the execution boundary unless external references are explicitly supplied.
 */
export function compileRevision(
  definition: RevisionDefinition
): CompiledRevisionPlan {
  const definitionErrors = validateRevisionDefinition(definition).filter(
    (issue) => issue.severity === "error"
  );
  if (definitionErrors.length) {
    const summary = definitionErrors
      .slice(0, 5)
      .map(
        (issue) =>
          `${issue.nodeId ?? "revision"}${issue.fieldId ? `/${issue.fieldId}` : ""}: ${issue.message}`
      )
      .join("; ");
    const more =
      definitionErrors.length > 5
        ? `; plus ${definitionErrors.length - 5} more error(s)`
        : "";
    throw new DcmsRuleError(
      "REVISION_DEFINITION_INVALID",
      `Revision definition is invalid: ${summary}${more}.`
    );
  }

  definition = frozenSnapshot(definition);
  const formElements = new Map<string, CompiledRevisionFormElement>();
  const nodeOrder: string[] = [];
  for (const element of definition.formElements) {
    const compiled: CompiledRevisionFormElement = {
      nodeId: element.nodeId,
      label: element.label,
      plan: compileForm(element.form)
    };
    formElements.set(element.nodeId, compiled);
    nodeOrder.push(element.nodeId);
  }

  return {
    key: getCompiledRevisionCacheKey(definition),
    revisionId: definition.revisionId,
    version: definition.version,
    formElements,
    nodeOrder,
    sourceHash: revisionDefinitionSourceHash(definition)
  };
}

function nodeOutcome(evaluation: ReturnType<typeof evaluateRecord>): {
  validationState: FieldValidationState | null;
  evaluationState: EvaluationState;
} {
  if (evaluation.errorFieldIds.length)
    return { validationState: null, evaluationState: "error" };
  if (evaluation.blockingFieldIds.length)
    return { validationState: "blocking", evaluationState: "ok" };
  if (evaluation.warningFieldIds.length)
    return { validationState: "warning", evaluationState: "ok" };
  if (evaluation.validFieldIds.length)
    return { validationState: "valid", evaluationState: "ok" };
  return { validationState: "not_validated", evaluationState: "ok" };
}

const revisionIdentities = new WeakMap<RevisionEvaluation, string>();
function rememberRevision(
  plan: CompiledRevisionPlan,
  result: RevisionEvaluation
): RevisionEvaluation {
  revisionIdentities.set(result, plan.key);
  return result;
}
function finalizeRevision(
  formElements: Map<string, RevisionFormElementEvaluation>
): RevisionEvaluation {
  const validNodeIds: string[] = [];
  const unvalidatedNodeIds: string[] = [];
  const warningNodeIds: string[] = [];
  const blockingNodeIds: string[] = [];
  const errorNodeIds: string[] = [];

  for (const [nodeId, result] of formElements) {
    if (result.evaluationState === "error") {
      errorNodeIds.push(nodeId);
      blockingNodeIds.push(nodeId);
      continue;
    }
    switch (result.validationState) {
      case "valid":
        validNodeIds.push(nodeId);
        break;
      case "not_validated":
        unvalidatedNodeIds.push(nodeId);
        break;
      case "warning":
        warningNodeIds.push(nodeId);
        break;
      case "blocking":
        blockingNodeIds.push(nodeId);
        break;
    }
  }

  return {
    formElements,
    canSubmit: blockingNodeIds.length === 0,
    validNodeIds,
    unvalidatedNodeIds,
    warningNodeIds,
    blockingNodeIds,
    errorNodeIds
  };
}

/**
 * Evaluate every independent Form and aggregate Record validation eligibility.
 * Unknown node inputs throw. This Map API treats omitted nodes as empty inputs;
 * evaluateRevisionPayload is stricter and requires every node in a submitted JSON payload.
 * Eligibility does not perform authorization or a database transaction.
 */
export function evaluateRevision(
  plan: CompiledRevisionPlan,
  enteredByNode: ReadonlyMap<string, ReadonlyMap<string, DcmsValue>>,
  options: RevisionEvaluationOptions = {}
): RevisionEvaluation {
  assertCompiledRevisionCompatible(plan);
  for (const id of enteredByNode.keys())
    if (!plan.formElements.has(id))
      throw new DcmsRuleError("PAYLOAD_INVALID", `Unknown Form Element ${id}.`);
  const formElements = new Map<string, RevisionFormElementEvaluation>();
  for (const nodeId of plan.nodeOrder) {
    const element = plan.formElements.get(nodeId)!;
    const entered = enteredByNode.get(nodeId) ?? new Map<string, DcmsValue>();
    const externalReferences = options.externalReferencesByNode?.get(nodeId);
    const evaluation = evaluateRecord(element.plan, entered, {
      externalReferences
    });
    const outcome = nodeOutcome(evaluation);
    formElements.set(nodeId, {
      nodeId,
      formId: element.plan.formId,
      validationState: outcome.validationState,
      evaluationState: outcome.evaluationState,
      evaluation
    });
  }
  return rememberRevision(plan, finalizeRevision(formElements));
}

/**
 * Evaluate a field edit and return aggregate Revision results. Other Forms are retained
 * only when their input snapshots still match; additional edits are evaluated too.
 * This does not create implicit cross-Form dependencies. See evaluateRevisionChangeDetailed.
 */
export function evaluateRevisionChange(
  plan: CompiledRevisionPlan,
  enteredByNode: ReadonlyMap<string, ReadonlyMap<string, DcmsValue>>,
  previous: RevisionEvaluation | undefined,
  nodeId: string,
  changedFieldId: string,
  options: RevisionEvaluationOptions = {}
): RevisionEvaluation {
  return evaluateRevisionChangeDetailed(
    plan,
    enteredByNode,
    previous,
    nodeId,
    changedFieldId,
    options
  ).evaluation;
}

/**
 * Update a target field and detect additional edits in other Form Elements from their snapshots.
 * Unknown nodes/fields throw. Unrecognized or stale previous results, or supplied external
 * references, require full Revision evaluation. Unchanged independent Forms retain their results.
 * Field-ID lists refer only to the target node; statusChangedNodeIds covers aggregate states.
 * On full fallback all target fields and all nodes are conservatively reported as status candidates.
 * No implicit cross-Form dependency graph is created.
 */
export function evaluateRevisionChangeDetailed(
  plan: CompiledRevisionPlan,
  enteredByNode: ReadonlyMap<string, ReadonlyMap<string, DcmsValue>>,
  previous: RevisionEvaluation | undefined,
  nodeId: string,
  changedFieldId: string,
  options: RevisionEvaluationOptions = {}
): RevisionChangeEvaluation {
  assertCompiledRevisionCompatible(plan);
  for (const id of enteredByNode.keys())
    if (!plan.formElements.has(id))
      throw new DcmsRuleError("PAYLOAD_INVALID", `Unknown Form Element ${id}.`);
  const element = plan.formElements.get(nodeId);
  if (!element)
    throw new DcmsRuleError(
      "REVISION_DEFINITION_INVALID",
      `Unknown Form Element node ${nodeId}.`
    );
  if (!element.plan.fields.has(changedFieldId))
    throw new DcmsRuleError(
      "PAYLOAD_INVALID",
      `Unknown changed field ${changedFieldId}.`
    );
  if (
    !previous ||
    revisionIdentities.get(previous) !== plan.key ||
    options.externalReferencesByNode
  ) {
    const evaluation = evaluateRevision(plan, enteredByNode, options);
    const node = evaluation.formElements.get(nodeId)!;
    return {
      evaluation,
      changedNodeId: nodeId,
      changedFieldIds: [changedFieldId],
      affectedFieldIds: [...element.plan.fieldOrder],
      statusChangedFieldIds: [...element.plan.fieldOrder],
      statusChangedNodeIds: [...plan.nodeOrder]
    };
  }

  const priorNode = previous.formElements.get(nodeId);
  const entered = enteredByNode.get(nodeId) ?? new Map<string, DcmsValue>();
  const externalReferences = undefined;
  const detail = evaluateChangeDetailed(
    element.plan,
    entered,
    priorNode?.evaluation,
    changedFieldId,
    { externalReferences }
  );
  const outcome = nodeOutcome(detail.evaluation);
  const nextNode: RevisionFormElementEvaluation = {
    nodeId,
    formId: element.plan.formId,
    validationState: outcome.validationState,
    evaluationState: outcome.evaluationState,
    evaluation: detail.evaluation
  };
  const formElements = new Map(previous.formElements);
  formElements.set(nodeId, nextNode);
  // A single announced edit is only a hint: callers may have changed another node as well.
  for (const otherId of plan.nodeOrder) {
    if (otherId === nodeId) continue;
    const other = plan.formElements.get(otherId)!;
    const old = previous.formElements.get(otherId);
    const values = enteredByNode.get(otherId) ?? new Map<string, DcmsValue>();
    if (isRecordEvaluationCurrent(other.plan, values, old?.evaluation))
      continue;
    const result = other.plan.fieldOrder.length
      ? evaluateChangeDetailed(
          other.plan,
          values,
          old?.evaluation,
          other.plan.fieldOrder[0]
        ).evaluation
      : evaluateRecord(other.plan, values);
    formElements.set(otherId, {
      nodeId: otherId,
      formId: other.plan.formId,
      ...nodeOutcome(result),
      evaluation: result
    });
  }
  const evaluation = rememberRevision(plan, finalizeRevision(formElements));
  const statusChangedNodeIds = plan.nodeOrder.filter(
    (id) =>
      previous.formElements.get(id)?.validationState !==
        evaluation.formElements.get(id)?.validationState ||
      previous.formElements.get(id)?.evaluationState !==
        evaluation.formElements.get(id)?.evaluationState
  );
  return {
    evaluation,
    changedNodeId: nodeId,
    changedFieldIds: detail.changedFieldIds,
    affectedFieldIds: detail.affectedFieldIds,
    statusChangedFieldIds: detail.statusChangedFieldIds,
    statusChangedNodeIds
  };
}
