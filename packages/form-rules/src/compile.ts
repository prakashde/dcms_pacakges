/**
 * Form compilation, dependency analysis, and authoritative/incremental evaluation.
 *
 * Why this is the core boundary: Form definitions are interpreted once, then both React keystrokes and Express
 * Save/Submit use the same compiled semantics. Field dependencies are explicit and read-only, which preserves field
 * ownership while allowing only affected dependents to be recalculated.
 */
import type {
  CompiledField,
  CompiledFormPlan,
  CompiledPlanStats,
  DcmsValue,
  FieldDefinition,
  FieldEvaluation,
  FormDefinition,
  RecordEvaluation,
  RecordChangeEvaluation,
  ValidationRowDefinition,
  ValidationRowEvaluation,
  ValidationFailureDetail,
  EvaluationOptions,
  EvaluationErrorDetail
} from "./types.js";
import { assertDcmsValue, frozenSnapshot, valueBudget } from "./boundaries.js";
import { DcmsRuleError } from "./errors.js";
import {
  prepareFormula,
  evaluatePreparedFormula
} from "./formula-evaluator.js";
import {
  compileValidationRule,
  combineValidationRowResults,
  runValidationRule
} from "./validation.js";
import {
  createValidationFailureDetail,
  formatValidationFailureDetail
} from "./validation-feedback.js";
import {
  FUNCTION_REGISTRY_FINGERPRINT,
  FORMULA_LANGUAGE_VERSION,
  FORMULA_COMPILER_VERSION,
  FORMULA_REGISTRY_VERSION,
  FORMULAJS_VERSION
} from "./functions.js";
import { DCMS_RULE_LIMITS_VERSION } from "./limits.js";
import { DCMS_KEYWORD_LANGUAGE_VERSION } from "./keyword-parser.js";
import { validateFormDefinition } from "./definition-validation.js";
import { formDefinitionSourceHash } from "./compatibility.js";
import { buildFieldInputGuidance } from "./guidance.js";

function normalizeValidationRows(
  f: FieldDefinition
): ValidationRowDefinition[] {
  if (f.validationRows?.length)
    return f.validationRows.map((r, i) => ({
      ...r,
      operator: i === 0 ? "AND" : (r.operator ?? "AND")
    }));
  if (f.formulaValidations?.length) {
    return f.formulaValidations.map((p, i) => ({
      id: p.id,
      label: p.label,
      expression: p.expression,
      operator: i === 0 ? "AND" : (p.validation.operator ?? "AND"),
      criteria: p.validation.criteria,
      keyword: p.validation.keyword,
      caseSensitive: p.validation.caseSensitive
    }));
  }
  if (f.validations?.length) {
    // Legacy v0.7 semantics: one field-wide expression is evaluated once and all legacy
    // validation rows validate that one calculated result.
    return f.validations.map((r, i) => ({
      id: `${f.id}__rule_${String(i + 1).padStart(2, "0")}`,
      label: `Rule ${i + 1}`,
      expression: null,
      operator: i === 0 ? "AND" : (r.operator ?? "AND"),
      criteria: r.criteria,
      keyword: r.keyword,
      caseSensitive: r.caseSensitive
    }));
  }
  return [];
}

function currentPlanCompatibilityParts(): string[] {
  return [
    `formula-${FORMULA_LANGUAGE_VERSION}`,
    `keywords-${DCMS_KEYWORD_LANGUAGE_VERSION}`,
    `registry-${FORMULA_REGISTRY_VERSION}`,
    `registryfp-${FUNCTION_REGISTRY_FINGERPRINT}`,
    `formulajs-${FORMULAJS_VERSION}`,
    `compiler-${FORMULA_COMPILER_VERSION}`,
    `limits-${DCMS_RULE_LIMITS_VERSION}`
  ];
}

/** Cache identity derived from the complete Form definition and every engine compatibility dimension. */
export function getCompiledPlanCacheKey(def: FormDefinition): string {
  return `${def.formId}:${def.version}:source-${formDefinitionSourceHash(def)}:${currentPlanCompatibilityParts().join(":")}`;
}

/**
 * Reject engine-version or registry mismatches with FORMULA_COMPATIBILITY.
 * This checks compatibility metadata, not the integrity of an arbitrarily mutated plan.
 * Keep compiled plans private and recompile definitions after an engine upgrade.
 */
export function assertCompiledPlanCompatible(plan: CompiledFormPlan): void {
  const mismatches: string[] = [];
  if (plan.registryFingerprint !== FUNCTION_REGISTRY_FINGERPRINT)
    mismatches.push("registry fingerprint");
  if (plan.registryVersion !== FORMULA_REGISTRY_VERSION)
    mismatches.push("registry version");
  if (plan.formulaJsVersion !== FORMULAJS_VERSION)
    mismatches.push("Formula.js version");
  if (plan.languageVersion !== FORMULA_LANGUAGE_VERSION)
    mismatches.push("formula language version");
  if (plan.keywordLanguageVersion !== DCMS_KEYWORD_LANGUAGE_VERSION)
    mismatches.push("Required Keywords language version");
  if (plan.compilerVersion !== FORMULA_COMPILER_VERSION)
    mismatches.push("compiler version");
  if (plan.limitsVersion !== DCMS_RULE_LIMITS_VERSION)
    mismatches.push("limits version");
  if (mismatches.length)
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `Compiled Form plan is incompatible with this engine: ${mismatches.join(", ")}.`
    );
}

/**
 * Validate and snapshot a Form, then prepare its rules, guidance and dependency graph.
 * Invalid authoring data throws DEFINITION_INVALID; legacy calculation cycles are rejected.
 * Reuse the returned plan without modifying its Maps, fields or prepared formulas.
 */
export function compileForm(def: FormDefinition): CompiledFormPlan {
  const definitionErrors = validateFormDefinition(def).filter(
    (issue) => issue.severity === "error"
  );
  if (definitionErrors.length) {
    const summary = definitionErrors
      .slice(0, 5)
      .map((issue) => `${issue.fieldId}: ${issue.message}`)
      .join("; ");
    const more =
      definitionErrors.length > 5
        ? `; plus ${definitionErrors.length - 5} more error(s)`
        : "";
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `Form definition is invalid: ${summary}${more}.`
    );
  }
  def = frozenSnapshot(def);
  const definitionHash = formDefinitionSourceHash(def);
  const fields = new Map<string, CompiledField>();
  const fieldIds = new Set(def.fields.map((x) => x.id));
  if (fieldIds.size !== def.fields.length)
    throw new DcmsRuleError(
      "DEFINITION_DUPLICATE_FIELD",
      "Form contains duplicate field IDs."
    );

  for (const f of def.fields) {
    const normalizedRows = normalizeValidationRows(f);
    const seenRows = new Set<string>();
    const validationRows = normalizedRows.map((row, i) => {
      if (!row.id?.trim())
        throw new DcmsRuleError(
          "DEFINITION_DUPLICATE_ROW",
          `Field ${f.id} rule ${i + 1} is missing an ID.`
        );
      if (seenRows.has(row.id))
        throw new DcmsRuleError(
          "DEFINITION_DUPLICATE_ROW",
          `Field ${f.id} has duplicate validation row ID ${row.id}.`
        );
      seenRows.add(row.id);
      const formula = row.expression?.trim()
        ? prepareFormula(row.expression)
        : undefined;
      return {
        definition: row,
        formula,
        references: formula?.references ?? [],
        validation: compileValidationRule(
          row,
          i === 0 ? "AND" : (row.operator ?? "AND")
        )
      };
    });

    // Legacy calculated-only expression is retained only when it is not already being used as the
    // expression of converted legacy validation rows.
    const legacyFormula =
      f.expression?.trim() &&
      !f.validationRows?.length &&
      !f.formulaValidations?.length
        ? prepareFormula(f.expression)
        : undefined;

    const refs = new Set<string>();
    for (const r of validationRows)
      for (const ref of r.references) refs.add(ref);
    if (legacyFormula)
      for (const ref of legacyFormula.references) refs.add(ref);
    const fieldDependencies = [...refs].filter((x) => fieldIds.has(x));
    const externalReferences = [...refs].filter((x) => !fieldIds.has(x));
    const compiledFieldBase = {
      definition: f,
      validationRows,
      legacyFormula,
      fieldDependencies,
      externalReferences
    };
    fields.set(f.id, {
      ...compiledFieldBase,
      inputGuidance: buildFieldInputGuidance(compiledFieldBase)
    });
  }

  // Only legacy calculated-field formulas form a recursive calculation chain. Validation-row
  // expressions read source/entered values of other fields and therefore do not create calculation cycles.
  const legacyDeps = new Map<string, Set<string>>();
  for (const [id, field] of fields) {
    legacyDeps.set(
      id,
      new Set(
        (field.legacyFormula?.references ?? []).filter((x) => fields.has(x))
      )
    );
  }
  const indeg = new Map<string, number>();
  const legacyDependents = new Map<string, Set<string>>();
  for (const id of fields.keys()) {
    indeg.set(id, legacyDeps.get(id)!.size);
    legacyDependents.set(id, new Set());
  }
  for (const [id, deps] of legacyDeps)
    for (const d of deps) legacyDependents.get(d)!.add(id);
  const q = [...fields.keys()].filter((id) => indeg.get(id) === 0);
  const fieldOrder: string[] = [];
  for (let qHead = 0; qHead < q.length; qHead++) {
    const id = q[qHead];
    fieldOrder.push(id);
    for (const d of legacyDependents.get(id)!) {
      indeg.set(d, indeg.get(d)! - 1);
      if (indeg.get(d) === 0) q.push(d);
    }
  }
  if (fieldOrder.length !== fields.size)
    throw new DcmsRuleError(
      "FORMULA_CIRCULAR_REFERENCE",
      "Circular legacy calculated-field dependency detected."
    );

  const dependents = new Map<string, Set<string>>();
  for (const id of fields.keys()) dependents.set(id, new Set());
  for (const [id, field] of fields)
    for (const dep of field.fieldDependencies) dependents.get(dep)!.add(id);

  return {
    key: getCompiledPlanCacheKey(def),
    formId: def.formId,
    version: def.version,
    fields,
    fieldOrder,
    dependents,
    registryFingerprint: FUNCTION_REGISTRY_FINGERPRINT,
    registryVersion: FORMULA_REGISTRY_VERSION,
    formulaJsVersion: FORMULAJS_VERSION,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    keywordLanguageVersion: DCMS_KEYWORD_LANGUAGE_VERSION,
    compilerVersion: FORMULA_COMPILER_VERSION,
    limitsVersion: DCMS_RULE_LIMITS_VERSION,
    sourceHash: definitionHash
  };
}

function makeReferenceMap(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  external?: ReadonlyMap<string, DcmsValue>
): Map<string, DcmsValue> {
  const refs = new Map<string, DcmsValue>();
  if (external) for (const [k, v] of external) refs.set(k, v);
  for (const id of plan.fieldOrder) refs.set(id, entered.get(id) ?? null);
  return refs;
}

function evaluateField(
  plan: CompiledFormPlan,
  id: string,
  entered: ReadonlyMap<string, DcmsValue>,
  legacyCalculated: Map<string, DcmsValue>,
  sourceReferences: ReadonlyMap<string, DcmsValue>
): FieldEvaluation {
  const field = plan.fields.get(id)!;
  const raw = entered.get(id) ?? null;
  let fieldCalculated: DcmsValue = raw;
  let fieldError: string | undefined;
  const evaluationErrorDetails: EvaluationErrorDetail[] = [];
  const captureError = (error: unknown, rowId?: string): string => {
    const message = error instanceof Error ? error.message : String(error);
    const controlled =
      error instanceof DcmsRuleError
        ? error
        : new DcmsRuleError("FORMULA_RUNTIME_ERROR", message);
    evaluationErrorDetails.push({
      code: controlled.code,
      category: controlled.category,
      message,
      rowId,
      position: controlled.position,
      length: controlled.length,
      functionName: controlled.functionName
    });
    return message;
  };

  if (field.legacyFormula) {
    const legacyRefs = new Map<string, DcmsValue>(sourceReferences);
    for (const [k, v] of legacyCalculated) legacyRefs.set(k, v);
    try {
      fieldCalculated = evaluatePreparedFormula(field.legacyFormula, {
        value: raw,
        references: legacyRefs
      });
    } catch (e) {
      fieldError = captureError(e);
      fieldCalculated = null;
    }
  }
  if (field.legacyFormula) legacyCalculated.set(id, fieldCalculated);

  const rowResults: ValidationRowEvaluation[] = [];
  const rowPasses: boolean[] = [];
  const rules = field.validationRows.map((x) => x.validation);
  for (const row of field.validationRows) {
    let calculated: DcmsValue = field.legacyFormula ? fieldCalculated : raw;
    let error: string | undefined;
    try {
      if (row.formula)
        calculated = evaluatePreparedFormula(row.formula, {
          value: raw,
          references: sourceReferences
        });
    } catch (e) {
      error = captureError(e, row.definition.id);
    }
    const validation = error
      ? { passed: false, failure: error }
      : runValidationRule(row.validation, calculated);
    const failureDetail =
      !error && !validation.passed
        ? createValidationFailureDetail(
            field.definition,
            row.definition,
            raw,
            calculated
          )
        : undefined;
    const validationMessage = failureDetail
      ? formatValidationFailureDetail(
          failureDetail,
          validation.failure ?? "Validation failed."
        )
      : validation.failure;
    rowPasses.push(validation.passed);
    rowResults.push({
      rowId: row.definition.id,
      label:
        row.definition.label ?? row.definition.resultLabel ?? row.definition.id,
      expression: row.definition.expression,
      calculatedValue: calculated,
      validationPassed: validation.passed,
      validationMessage,
      ...(failureDetail ? { failureDetail } : {}),
      error
    });
  }

  const combinedPassed = combineValidationRowResults(rules, rowPasses);
  const evaluationErrors: string[] = [];
  if (fieldError) evaluationErrors.push(`Field formula: ${fieldError}`);
  for (const row of rowResults)
    if (row.error) evaluationErrors.push(`${row.label}: ${row.error}`);

  const hasValidation = rules.length > 0;
  const ordinaryValidationPassed = !hasValidation || combinedPassed;
  const validationPassed =
    evaluationErrors.length === 0 && ordinaryValidationPassed;
  const validationFailures: string[] = [];
  const failureDetails: ValidationFailureDetail[] = [];
  if (!combinedPassed) {
    for (let i = 0; i < rules.length; i++) {
      const rawPassed = rowPasses[i] ?? false;
      const negated =
        i > 0 &&
        (rules[i].operator === "AND NOT" || rules[i].operator === "OR NOT");
      const operandPassed = negated ? !rawPassed : rawPassed;
      if (operandPassed) continue;
      if (negated && rawPassed) {
        validationFailures.push(
          `${rowResults[i].label}: ${rules[i].operator} condition matched; NOT makes this row operand FALSE.`
        );
      } else if (!rowResults[i].error) {
        validationFailures.push(
          `${rowResults[i].label}: ${rowResults[i].validationMessage ?? "Validation failed"}`
        );
        const detail = rowResults[i].failureDetail;
        if (detail) failureDetails.push(detail);
      }
    }
    if (!validationFailures.length)
      validationFailures.push(
        "Combined validation result failed after applying NOT > AND > OR precedence."
      );
  }
  const messages = [...evaluationErrors, ...validationFailures];
  const evaluationState =
    evaluationErrors.length > 0 ? ("error" as const) : ("ok" as const);
  const validationState =
    evaluationState === "error"
      ? null
      : !hasValidation
        ? ("not_validated" as const)
        : ordinaryValidationPassed
          ? ("valid" as const)
          : field.definition.mustBeCorrect
            ? ("blocking" as const)
            : ("warning" as const);
  const blocking =
    evaluationState === "error" || validationState === "blocking";
  return {
    fieldId: id,
    enteredValue: raw,
    calculatedValue: fieldCalculated,
    expressionApplied:
      !!field.legacyFormula || field.validationRows.some((x) => !!x.formula),
    validationRowResults: rowResults,
    formulaValidationResults: rowResults,
    failureDetails,
    validationPassed,
    blocking,
    failures: blocking ? messages : [],
    warnings: validationState === "warning" ? messages : [],
    hasValidation,
    validationState,
    evaluationState,
    inputGuidance: field.inputGuidance,
    evaluationErrors,
    evaluationErrorDetails,
    error: evaluationErrors[0]
  };
}

function finalize(values: Map<string, FieldEvaluation>): RecordEvaluation {
  const invalidFieldIds: string[] = [];
  const blockingFieldIds: string[] = [];
  const warningFieldIds: string[] = [];
  const validFieldIds: string[] = [];
  const unvalidatedFieldIds: string[] = [];
  const errorFieldIds: string[] = [];
  for (const [id, v] of values) {
    if (
      v.evaluationState === "error" ||
      v.validationState === "warning" ||
      v.validationState === "blocking"
    )
      invalidFieldIds.push(id);
    if (v.evaluationState === "error") {
      errorFieldIds.push(id);
      blockingFieldIds.push(id);
      continue;
    }
    if (v.validationState === "blocking") blockingFieldIds.push(id);
    else if (v.validationState === "warning") warningFieldIds.push(id);
    else if (v.validationState === "valid") validFieldIds.push(id);
    else if (v.validationState === "not_validated")
      unvalidatedFieldIds.push(id);
  }
  return {
    values,
    // Correction Draft Save policy remains subject to the documented FR-REC-18 decision.
    canSave: true,
    canSubmit: blockingFieldIds.length === 0,
    blockingFieldIds,
    invalidFieldIds,
    warningFieldIds,
    validFieldIds,
    unvalidatedFieldIds,
    errorFieldIds
  };
}

/**
 * Fully evaluate a compatible Form against current entered and trusted external values.
 * Unknown entered fields or malformed values throw; per-row runtime failures become
 * structured field errors and block Submit. canSave/canSubmit express validation policy,
 * not authorization or successful persistence. Returned objects must be treated as read-only.
 */
export function evaluateRecord(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  options: EvaluationOptions = {}
): RecordEvaluation {
  assertCompiledPlanCompatible(plan);
  checkValues(plan, entered, options);
  const values = new Map<string, FieldEvaluation>();
  const legacyCalculated = new Map<string, DcmsValue>();
  const sourceReferences = makeReferenceMap(
    plan,
    entered,
    options.externalReferences
  );
  for (const id of plan.fieldOrder)
    values.set(
      id,
      evaluateField(plan, id, entered, legacyCalculated, sourceReferences)
    );
  return rememberEvaluation(plan, entered, options, finalize(values));
}

/**
 * Return changedId and its transitive dependents, visiting each ID once.
 * This graph helper does not validate changedId; evaluateChangeDetailed does.
 */
export function affectedFields(
  plan: CompiledFormPlan,
  changedId: string
): Set<string> {
  const out = new Set<string>([changedId]);
  const q = [changedId];
  for (let qHead = 0; qHead < q.length; qHead++) {
    const x = q[qHead];
    for (const d of plan.dependents.get(x) ?? [])
      if (!out.has(d)) {
        out.add(d);
        q.push(d);
      }
  }
  return out;
}

/** Compile-time acceptable-input / calculated-criteria guidance for one field. */
export function getFieldInputGuidance(plan: CompiledFormPlan, fieldId: string) {
  const field = plan.fields.get(fieldId);
  if (!field)
    throw new DcmsRuleError("DEFINITION_INVALID", `Unknown field ${fieldId}.`);
  return field.inputGuidance;
}

/**
 * Private, detached snapshots detect array mutations and missed edits. WeakMap ownership
 * deliberately makes a deserialized result ineligible for reuse and allows garbage collection.
 */
const evaluationInputs = new WeakMap<
  RecordEvaluation,
  {
    key: string;
    entered: Map<string, DcmsValue>;
    external: Map<string, DcmsValue>;
  }
>();
function checkValues(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  options: EvaluationOptions
): void {
  const budget = valueBudget();
  for (const [id, value] of entered) {
    if (!plan.fields.has(id))
      throw new DcmsRuleError(
        "PAYLOAD_INVALID",
        `Unknown input field ${id}. Use approved externalReferences for external data.`
      );
    assertDcmsValue(value, `Field ${id}`, budget);
  }
  for (const [id, value] of options.externalReferences ?? []) {
    if (plan.fields.has(id))
      throw new DcmsRuleError(
        "PAYLOAD_INVALID",
        `External reference ${id} collides with a Form field.`
      );
    assertDcmsValue(value, `External reference ${id}`, budget);
  }
}
function snapshotValues(
  values?: ReadonlyMap<string, DcmsValue>
): Map<string, DcmsValue> {
  return new Map(
    [...(values ?? [])].map(([id, value]) => [id, frozenSnapshot(value)])
  );
}
function rememberEvaluation(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  options: EvaluationOptions,
  result: RecordEvaluation
): RecordEvaluation {
  evaluationInputs.set(result, {
    key: plan.key,
    entered: snapshotValues(entered),
    external: snapshotValues(options.externalReferences)
  });
  return result;
}
function sameValue(
  a: DcmsValue | undefined,
  b: DcmsValue | undefined
): boolean {
  if (a === b) return true;
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((x, i) => sameValue(x, b[i]))
  );
}
function sameMap(
  a: ReadonlyMap<string, DcmsValue>,
  b?: ReadonlyMap<string, DcmsValue>
): boolean {
  return (
    a.size === (b?.size ?? 0) &&
    [...a].every(([id, value]) => b?.has(id) && sameValue(value, b.get(id)))
  );
}

/**
 * Recognize a previous evaluation from this engine whose plan and entered snapshot match.
 * Only evaluations without external references qualify. Serialized or caller-created
 * results have no private snapshot and return false; this is a reuse check, not authorization.
 */
export function isRecordEvaluationCurrent(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  previous: RecordEvaluation | undefined
): boolean {
  const prior = previous ? evaluationInputs.get(previous) : undefined;
  return (
    !!prior &&
    prior.key === plan.key &&
    sameMap(prior.entered, entered) &&
    prior.external.size === 0
  );
}

/** Browser hot path; a stale/unrecognized previous result automatically receives a full evaluation. */
export function evaluateChange(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  previous: RecordEvaluation | undefined,
  changedId: string,
  options: EvaluationOptions = {}
): RecordEvaluation {
  return evaluateChangeDetailed(plan, entered, previous, changedId, options)
    .evaluation;
}
/**
 * Report the announced edit, additionally detected edits, affected fields and status changes.
 * The complete input snapshot detects additional edits beyond changedId. Unrecognized
 * prior results, incompatible identities or changed external values trigger full evaluation.
 * Unaffected FieldEvaluation objects may be reused; treat all returned results as read-only.
 * Status changes cover evaluation/validation states, not every value or message change.
 */
export function evaluateChangeDetailed(
  plan: CompiledFormPlan,
  entered: ReadonlyMap<string, DcmsValue>,
  previous: RecordEvaluation | undefined,
  changedId: string,
  options: EvaluationOptions = {}
): RecordChangeEvaluation {
  assertCompiledPlanCompatible(plan);
  if (!plan.fields.has(changedId))
    throw new DcmsRuleError(
      "PAYLOAD_INVALID",
      `Unknown changed field ${changedId}.`
    );
  checkValues(plan, entered, options);
  const prior = previous ? evaluationInputs.get(previous) : undefined;
  const changedFieldIds =
    prior && prior.key === plan.key
      ? plan.fieldOrder.filter(
          (id) =>
            id === changedId ||
            !sameValue(prior.entered.get(id), entered.get(id))
        )
      : [changedId];
  // The graph tracks Form fields, so changed external data conservatively invalidates every field.
  const reuse =
    !!previous &&
    prior?.key === plan.key &&
    sameMap(prior.external, options.externalReferences);
  const impacted = new Set<string>();
  if (reuse)
    for (const id of changedFieldIds)
      for (const affected of affectedFields(plan, id)) impacted.add(affected);
  else for (const id of plan.fieldOrder) impacted.add(id);
  let evaluation: RecordEvaluation;
  if (!reuse) evaluation = evaluateRecord(plan, entered, options);
  else {
    const values = new Map(previous!.values);
    const legacyCalculated = new Map<string, DcmsValue>();
    for (const [id, v] of values)
      if (!impacted.has(id) && plan.fields.get(id)?.legacyFormula)
        legacyCalculated.set(id, v.calculatedValue);
    const sourceReferences = makeReferenceMap(
      plan,
      entered,
      options.externalReferences
    );
    for (const id of plan.fieldOrder)
      if (impacted.has(id))
        values.set(
          id,
          evaluateField(plan, id, entered, legacyCalculated, sourceReferences)
        );
    evaluation = rememberEvaluation(plan, entered, options, finalize(values));
  }
  const affectedFieldIds = plan.fieldOrder.filter((id) => impacted.has(id));
  const statusChangedFieldIds = affectedFieldIds.filter(
    (id) =>
      !previous ||
      previous.values.get(id)?.validationState !==
        evaluation.values.get(id)?.validationState ||
      previous.values.get(id)?.evaluationState !==
        evaluation.values.get(id)?.evaluationState
  );
  return {
    evaluation,
    changedFieldIds,
    affectedFieldIds,
    statusChangedFieldIds
  };
}

/**
 * Count prepared formulas, rules, AST nodes and dependency edges without evaluating values.
 * The legacy formulaInstructionCells property reports AST nodes; there is no bytecode VM.
 */
export function getCompiledPlanStats(
  plan: CompiledFormPlan
): CompiledPlanStats {
  let formulaCount = 0,
    validationRuleCount = 0,
    preparedNodeCount = 0,
    dependencyEdgeCount = 0;
  for (const f of plan.fields.values()) {
    if (f.legacyFormula) {
      formulaCount++;
      preparedNodeCount += f.legacyFormula.nodeCount;
    }
    for (const r of f.validationRows) {
      validationRuleCount++;
      if (r.formula) {
        formulaCount++;
        preparedNodeCount += r.formula.nodeCount;
      }
    }
    dependencyEdgeCount += f.fieldDependencies.length;
  }
  return {
    fieldCount: plan.fields.size,
    formulaCount,
    validationRuleCount,
    formulaInstructionCells: preparedNodeCount,
    dependencyEdgeCount
  };
}
