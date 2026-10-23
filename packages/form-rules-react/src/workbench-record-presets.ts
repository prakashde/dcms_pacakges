/**
 * Definition-aware Record-value presets over one exact accepted Workbench authority.
 *
 * Presets replace current Record values only. Accepted Original values, reusable
 * seed fixtures, Form definitions, presentation models, descriptions, ordering,
 * Revision metadata, authoring dirtiness, and selection remain unchanged.
 */
import {
  canonicalJson,
  compileForm,
  evaluateRecord,
  parseKeywordExpression,
  type CompiledFormPlan,
  type DcmsValue,
  type KeywordNode,
  type RecordEvaluation
} from "@dcms/form-rules";
import { cloneFrozenGraph, freezeOwnedGraph } from "./immutable.js";
import type {
  WorkbenchFieldModel,
  WorkbenchFormModel
} from "./workbench-model.js";
import type {
  WorkbenchRevisionSessionAuthorityV2,
  WorkbenchRevisionSessionFormV2,
  WorkbenchRevisionSessionManagerV2
} from "./workbench-revision-session.js";
import type {
  WorkbenchFormSnapshot,
  WorkbenchSnapshot
} from "./workbench-store.js";

export const WORKBENCH_RECORD_PRESET_KINDS = [
  "original",
  "seeded",
  "valid",
  "blocking",
  "warning"
] as const;
export type WorkbenchRecordPresetKindV2 =
  (typeof WORKBENCH_RECORD_PRESET_KINDS)[number];

export const WORKBENCH_RECORD_PRESET_SCOPES = [
  "active-form",
  "all-forms"
] as const;
export type WorkbenchRecordPresetScopeV2 =
  (typeof WORKBENCH_RECORD_PRESET_SCOPES)[number];

export interface WorkbenchRecordPresetUnavailableFormV2 {
  readonly nodeId: string;
  readonly title: string;
  readonly reason: string;
}

export interface WorkbenchRecordPresetFormSummaryV2 {
  readonly nodeId: string;
  readonly title: string;
  readonly canSubmit: boolean;
  readonly blockingFieldCount: number;
  readonly warningFieldCount: number;
  readonly evaluationErrorFieldCount: number;
  readonly invalidFieldCount: number;
}

export interface WorkbenchRecordPresetSummaryV2 {
  readonly kind: WorkbenchRecordPresetKindV2;
  readonly scope: WorkbenchRecordPresetScopeV2;
  readonly available: boolean;
  readonly targetFormCount: number;
  readonly targetFieldCount: number;
  readonly eligibleFormCount: number;
  readonly blockingFormCount: number;
  readonly warningFormCount: number;
  readonly evaluationErrorFormCount: number;
  readonly preservesOriginalValues: true;
  readonly preservesSeedValues: true;
  readonly preservesRevisionStructure: true;
  readonly forms: readonly WorkbenchRecordPresetFormSummaryV2[];
  readonly unavailableForms: readonly WorkbenchRecordPresetUnavailableFormV2[];
}

export interface WorkbenchRecordPresetProposalV2 {
  readonly authority: WorkbenchRevisionSessionAuthorityV2;
  readonly kind: WorkbenchRecordPresetKindV2;
  readonly scope: WorkbenchRecordPresetScopeV2;
  readonly available: boolean;
  readonly valuesByNode: ReadonlyMap<string, ReadonlyMap<string, DcmsValue>>;
  readonly evaluationsByNode: ReadonlyMap<string, RecordEvaluation>;
  readonly summary: WorkbenchRecordPresetSummaryV2;
}

export type WorkbenchRecordPresetConfirmationErrorCodeV2 =
  | "RECORD_PRESET_AUTHORITY_STALE"
  | "RECORD_PRESET_UNAVAILABLE";

export type WorkbenchRecordPresetConfirmationResultV2 =
  | {
      readonly accepted: true;
      readonly managerSnapshot: WorkbenchRevisionSessionAuthorityV2["managerSnapshot"];
      readonly storeSnapshot: WorkbenchSnapshot;
      readonly summary: WorkbenchRecordPresetSummaryV2;
    }
  | {
      readonly accepted: false;
      readonly code: WorkbenchRecordPresetConfirmationErrorCodeV2;
      readonly error: string;
      readonly managerSnapshot: WorkbenchRevisionSessionAuthorityV2["managerSnapshot"];
      readonly storeSnapshot: WorkbenchSnapshot;
      readonly summary: WorkbenchRecordPresetSummaryV2;
    };

interface CandidateResult {
  values: Map<string, DcmsValue>;
  evaluation: RecordEvaluation;
  unavailableReason?: string;
}

interface TextRequirements {
  include: string[];
  exclude: string[];
}

function cloneValue(value: DcmsValue): DcmsValue {
  return Array.isArray(value) ? value.map(cloneValue) : value;
}

function cloneValueMap(values: ReadonlyMap<string, DcmsValue>) {
  return new Map(
    [...values].map(([fieldId, value]) => [fieldId, cloneValue(value)])
  );
}

function valueKey(value: DcmsValue) {
  return canonicalJson(value);
}

function uniqueValues(values: readonly DcmsValue[]) {
  const seen = new Set<string>();
  const result: DcmsValue[] = [];
  for (const value of values) {
    const key = valueKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneValue(value));
  }
  return result;
}

function keywordRequirements(
  node: KeywordNode,
  desired: boolean
): TextRequirements[] {
  switch (node.kind) {
    case "term":
      return desired
        ? [{ include: [node.value], exclude: [] }]
        : [{ include: [], exclude: [node.value] }];
    case "not":
      return keywordRequirements(node.value, !desired);
    case "and":
      if (!desired) {
        return [
          ...keywordRequirements(node.left, false),
          ...keywordRequirements(node.right, false)
        ];
      }
      return combineTextRequirements(
        keywordRequirements(node.left, true),
        keywordRequirements(node.right, true)
      );
    case "or":
      if (desired) {
        return [
          ...keywordRequirements(node.left, true),
          ...keywordRequirements(node.right, true)
        ];
      }
      return combineTextRequirements(
        keywordRequirements(node.left, false),
        keywordRequirements(node.right, false)
      );
  }
}

function combineTextRequirements(
  left: readonly TextRequirements[],
  right: readonly TextRequirements[]
): TextRequirements[] {
  const combined: TextRequirements[] = [];
  for (const a of left) {
    for (const b of right) {
      combined.push({
        include: [...a.include, ...b.include],
        exclude: [...a.exclude, ...b.exclude]
      });
      if (combined.length >= 32) return combined;
    }
  }
  return combined;
}

function textFromRequirements(requirements: TextRequirements) {
  const excludes = requirements.exclude.map((value) => value.toLowerCase());
  const includes = requirements.include.filter((value) => {
    const normalized = value.toLowerCase();
    return !excludes.some(
      (excluded) =>
        normalized.includes(excluded) || excluded.includes(normalized)
    );
  });
  const value = includes.join(" ").trim();
  if (excludes.some((excluded) => value.toLowerCase().includes(excluded))) {
    return undefined;
  }
  return value || "ACCEPTED";
}

function keywordCandidates(field: WorkbenchFieldModel) {
  const candidates: string[] = [];
  for (const row of field.validationRows) {
    if (row.criteria !== "required_keywords" || typeof row.keyword !== "string")
      continue;
    try {
      const ast = parseKeywordExpression(row.keyword);
      for (const requirements of keywordRequirements(ast, true)) {
        const value = textFromRequirements(requirements);
        if (value !== undefined) candidates.push(value);
      }
    } catch {
      // The accepted definition has already compiled. This branch is defensive
      // for caller-provided models that drift from their accepted definition.
    }
  }
  return candidates;
}

function numericCandidates(field: WorkbenchFieldModel) {
  const numbers = new Set<number>([
    -999999, -1000, -100, -40, -10, -1, 0, 1, 10, 20, 50, 72, 80, 90, 99, 100,
    101, 180, 200, 220, 999, 1000, 999999
  ]);
  const directLower: number[] = [];
  const directUpper: number[] = [];
  for (const row of field.validationRows) {
    const keyword = Number(row.keyword);
    if (!Number.isFinite(keyword)) continue;
    for (const offset of [-1, -0.1, 0, 0.1, 1]) {
      numbers.add(keyword + offset);
    }
    if (!row.expression && row.criteria === "number_greater_than") {
      directLower.push(keyword);
    }
    if (!row.expression && row.criteria === "number_less_than") {
      directUpper.push(keyword);
    }
  }
  if (directLower.length && directUpper.length) {
    const lower = Math.max(...directLower);
    const upper = Math.min(...directUpper);
    if (lower < upper) numbers.add((lower + upper) / 2);
  }
  if (field.id === "temp_f" || field.id.startsWith("temp_")) numbers.add(72);
  if (field.id === "actual_pressure") numbers.add(100);
  if (field.id === "limit_pressure") numbers.add(220);
  if (field.id.startsWith("pressure_")) numbers.add(80);
  return [...numbers].filter(Number.isFinite);
}

function boundedText(length: number) {
  const safeLength = Math.max(0, Math.min(8192, Math.trunc(length)));
  return "A".repeat(safeLength);
}

function textLengthCandidates(field: WorkbenchFieldModel) {
  const lengths = new Set<number>([0, 1, 2, 5, 10, 20, 50, 100]);
  for (const row of field.validationRows) {
    if (!row.criteria.startsWith("character_limit_")) continue;
    const keyword = Number(row.keyword);
    if (!Number.isFinite(keyword)) continue;
    lengths.add(keyword - 1);
    lengths.add(keyword);
    lengths.add(keyword + 1);
  }
  return [...lengths].filter((length) => length >= 0).map(boundedText);
}

function selectionKeywords(field: WorkbenchFieldModel) {
  const values: string[] = [];
  for (const row of field.validationRows) {
    if (!row.criteria.startsWith("selection_values_")) continue;
    const keywords = Array.isArray(row.keyword)
      ? row.keyword
      : [String(row.keyword)];
    for (const keyword of keywords) values.push(String(keyword));
  }
  return values;
}

function knownGoodValue(field: WorkbenchFieldModel): DcmsValue {
  if (field.category === "Checkbox") {
    if (field.options.includes("Secured")) {
      return field.options.filter((option) => option !== "Damaged");
    }
    return field.options.length ? [field.options[0]] : [];
  }
  if (field.category === "Radio") {
    return field.options.includes("Pass") ? "Pass" : (field.options[0] ?? "");
  }
  if (field.valueType === "number") {
    if (field.id === "temp_f") return 72;
    if (field.id === "actual_pressure") return 100;
    if (field.id === "limit_pressure") return 220;
    if (field.id.startsWith("temp_")) return 72;
    if (field.id.startsWith("pressure_")) return 80;
    return 10;
  }
  if (field.id === "lorem") return "Linear 414 ST4020";
  if (field.id === "software_version") return "V1.2.3";
  if (field.id === "pcb_sn") return "41450946";
  return "PASS LOT A123";
}

function fieldCandidates(
  field: WorkbenchFieldModel,
  seed: DcmsValue | undefined,
  original: DcmsValue | undefined,
  current: DcmsValue | undefined
) {
  const values: DcmsValue[] = [];
  if (seed !== undefined) values.push(seed);
  if (current !== undefined) values.push(current);
  if (original !== undefined) values.push(original);
  values.push(knownGoodValue(field));

  if (field.category === "Number") {
    values.push(...numericCandidates(field));
  } else if (field.category === "Checkbox") {
    const keywords = selectionKeywords(field);
    const preferred = field.options.filter(
      (option) =>
        !/damaged|fail|failed|reject|rejected|missing|hold|incomplete/i.test(
          option
        )
    );
    values.push(
      [],
      field.options,
      preferred,
      keywords,
      ...field.options.map((option) => [option]),
      ...keywords.map((keyword) => [keyword]),
      ["Damaged"],
      ["REJECT"]
    );
  } else if (field.category === "Radio") {
    const keywords = selectionKeywords(field);
    const preferred = [
      "Completed",
      "Pass",
      "Approved",
      "Accepted",
      "Accept",
      "Yes",
      "Normal",
      "Secured"
    ];
    values.push(
      ...preferred.filter((value) => field.options.includes(value)),
      ...keywords,
      ...field.options,
      "Fail",
      "Hold",
      "REJECT",
      ""
    );
  } else {
    values.push(
      ...keywordCandidates(field),
      ...textLengthCandidates(field),
      ...selectionKeywords(field),
      "READY",
      "Completed",
      "PASS LOT A123",
      "Linear 414 ST4020",
      "V1.2.3",
      "41450946",
      "ACCEPTED",
      "no match",
      "REJECT",
      ""
    );
  }

  return uniqueValues(values);
}

function issueScore(evaluation: RecordEvaluation) {
  return (
    evaluation.errorFieldIds.length * 1_000_000_000 +
    evaluation.blockingFieldIds.length * 1_000_000 +
    evaluation.warningFieldIds.length * 1_000 +
    evaluation.invalidFieldIds.length
  );
}

function isExactValid(evaluation: RecordEvaluation) {
  return (
    evaluation.canSubmit &&
    evaluation.errorFieldIds.length === 0 &&
    evaluation.blockingFieldIds.length === 0 &&
    evaluation.warningFieldIds.length === 0 &&
    evaluation.invalidFieldIds.length === 0
  );
}

function exactStateReason(evaluation: RecordEvaluation) {
  const parts: string[] = [];
  if (evaluation.errorFieldIds.length)
    parts.push(`${evaluation.errorFieldIds.length} evaluation error field(s)`);
  if (evaluation.blockingFieldIds.length)
    parts.push(`${evaluation.blockingFieldIds.length} blocking field(s)`);
  if (evaluation.warningFieldIds.length)
    parts.push(`${evaluation.warningFieldIds.length} warning field(s)`);
  if (!parts.length && !evaluation.canSubmit)
    parts.push("Record submission is not permitted");
  return parts.join(", ") || "the requested state could not be produced";
}

function buildValidCandidate(
  plan: CompiledFormPlan,
  snapshot: WorkbenchFormSnapshot,
  fixture: WorkbenchRevisionSessionFormV2,
  model: WorkbenchFormModel
): CandidateResult {
  let values = cloneValueMap(fixture.seedValues);
  let evaluation = evaluateRecord(plan, values);
  let score = issueScore(evaluation);
  if (score === 0 && isExactValid(evaluation)) return { values, evaluation };

  for (let pass = 0; pass < 5 && score > 0; pass += 1) {
    let improved = false;
    for (const field of model.fields) {
      const currentFieldValue = values.get(field.id);
      let bestValues = values;
      let bestEvaluation = evaluation;
      let bestScore = score;
      for (const candidate of fieldCandidates(
        field,
        fixture.seedValues.get(field.id),
        snapshot.originalValues.get(field.id),
        snapshot.values.get(field.id)
      )) {
        if (
          currentFieldValue !== undefined &&
          valueKey(currentFieldValue) === valueKey(candidate)
        ) {
          continue;
        }
        const nextValues = new Map(values);
        nextValues.set(field.id, cloneValue(candidate));
        const nextEvaluation = evaluateRecord(plan, nextValues);
        const nextScore = issueScore(nextEvaluation);
        if (nextScore < bestScore) {
          bestValues = nextValues;
          bestEvaluation = nextEvaluation;
          bestScore = nextScore;
          if (bestScore === 0) break;
        }
      }
      if (bestScore < score) {
        values = bestValues;
        evaluation = bestEvaluation;
        score = bestScore;
        improved = true;
      }
      if (score === 0) break;
    }
    if (!improved) break;
  }

  if (isExactValid(evaluation)) return { values, evaluation };
  return {
    values,
    evaluation,
    unavailableReason:
      "An exact Valid preset is unavailable for this accepted definition: " +
      `${exactStateReason(evaluation)}.`
  };
}

function buildScenarioCandidate(
  kind: "blocking" | "warning",
  plan: CompiledFormPlan,
  snapshot: WorkbenchFormSnapshot,
  fixture: WorkbenchRevisionSessionFormV2,
  model: WorkbenchFormModel
): CandidateResult {
  const valid = buildValidCandidate(plan, snapshot, fixture, model);
  if (valid.unavailableReason) {
    return {
      ...valid,
      unavailableReason:
        `${kind === "blocking" ? "Blocking" : "Warning"} preset requires ` +
        `a clean Valid baseline. ${valid.unavailableReason}`
    };
  }

  const targetFields = model.fields.filter(
    (field) =>
      field.validationRows.length > 0 &&
      (kind === "blocking" ? field.mustBeCorrect : !field.mustBeCorrect)
  );
  if (!targetFields.length) {
    return {
      ...valid,
      unavailableReason:
        kind === "blocking"
          ? "No Must Be Correct field with validation rows is available for a Blocking preset."
          : "No non-blocking field with validation rows is available for a Warning preset."
    };
  }

  let selected:
    | {
        values: Map<string, DcmsValue>;
        evaluation: RecordEvaluation;
        score: number;
      }
    | undefined;
  for (const field of targetFields) {
    const acceptedValue = valid.values.get(field.id);
    for (const candidate of fieldCandidates(
      field,
      fixture.seedValues.get(field.id),
      snapshot.originalValues.get(field.id),
      snapshot.values.get(field.id)
    )) {
      if (
        acceptedValue !== undefined &&
        valueKey(acceptedValue) === valueKey(candidate)
      ) {
        continue;
      }
      const nextValues = new Map(valid.values);
      nextValues.set(field.id, cloneValue(candidate));
      const nextEvaluation = evaluateRecord(plan, nextValues);
      const matches =
        kind === "blocking"
          ? !nextEvaluation.canSubmit &&
            nextEvaluation.errorFieldIds.length === 0 &&
            nextEvaluation.blockingFieldIds.includes(field.id) &&
            nextEvaluation.warningFieldIds.length === 0
          : nextEvaluation.canSubmit &&
            nextEvaluation.errorFieldIds.length === 0 &&
            nextEvaluation.blockingFieldIds.length === 0 &&
            nextEvaluation.warningFieldIds.includes(field.id);
      if (!matches) continue;
      const scenarioScore =
        nextEvaluation.blockingFieldIds.length +
        nextEvaluation.warningFieldIds.length;
      if (!selected || scenarioScore < selected.score) {
        selected = {
          values: nextValues,
          evaluation: nextEvaluation,
          score: scenarioScore
        };
      }
      if (scenarioScore === 1) break;
    }
    if (selected?.score === 1) break;
  }

  if (selected) {
    return { values: selected.values, evaluation: selected.evaluation };
  }
  return {
    ...valid,
    unavailableReason:
      kind === "blocking"
        ? "No deterministic value candidate produced a blocking validation state without an evaluation error."
        : "No deterministic value candidate produced an eligible warning-only validation state."
  };
}

function formCandidate(
  kind: WorkbenchRecordPresetKindV2,
  snapshot: WorkbenchFormSnapshot,
  fixture: WorkbenchRevisionSessionFormV2,
  model: WorkbenchFormModel
): CandidateResult {
  const plan = compileForm(snapshot.definition);
  if (kind === "original") {
    const values = cloneValueMap(snapshot.originalValues);
    return { values, evaluation: evaluateRecord(plan, values) };
  }
  if (kind === "seeded") {
    const values = cloneValueMap(fixture.seedValues);
    return { values, evaluation: evaluateRecord(plan, values) };
  }
  if (kind === "valid") {
    return buildValidCandidate(plan, snapshot, fixture, model);
  }
  return buildScenarioCandidate(kind, plan, snapshot, fixture, model);
}

function targetedForms(
  authority: WorkbenchRevisionSessionAuthorityV2,
  scope: WorkbenchRecordPresetScopeV2
) {
  const forms = authority.storeSnapshot.forms;
  if (scope === "all-forms") return forms;
  const activeNodeId = authority.storeSnapshot.activeNodeId;
  const active = forms.find((form) => form.nodeId === activeNodeId);
  if (!active) {
    throw new Error(
      "The accepted Workbench has no active Form for this preset."
    );
  }
  return [active];
}

function formSummary(
  form: WorkbenchFormSnapshot,
  evaluation: RecordEvaluation
): WorkbenchRecordPresetFormSummaryV2 {
  return {
    nodeId: form.nodeId,
    title: form.title,
    canSubmit: evaluation.canSubmit,
    blockingFieldCount: evaluation.blockingFieldIds.length,
    warningFieldCount: evaluation.warningFieldIds.length,
    evaluationErrorFieldCount: evaluation.errorFieldIds.length,
    invalidFieldCount: evaluation.invalidFieldIds.length
  };
}

/**
 * Prepare one values-only preset from one exact accepted authority. Preparation
 * never changes the Workbench. Every target is fully evaluated before the
 * proposal is marked available.
 */
export function createWorkbenchRecordPresetProposalFromAuthorityV2(
  authority: WorkbenchRevisionSessionAuthorityV2,
  options: {
    readonly kind: WorkbenchRecordPresetKindV2;
    readonly scope: WorkbenchRecordPresetScopeV2;
  }
): WorkbenchRecordPresetProposalV2 {
  if (!WORKBENCH_RECORD_PRESET_KINDS.includes(options.kind)) {
    throw new Error(
      `Unknown Workbench Record preset: ${String(options.kind)}.`
    );
  }
  if (!WORKBENCH_RECORD_PRESET_SCOPES.includes(options.scope)) {
    throw new Error(
      `Unknown Workbench Record preset scope: ${String(options.scope)}.`
    );
  }
  const session = authority.managerSnapshot.session;
  if (session.store.getSnapshot() !== authority.storeSnapshot) {
    throw new Error(
      "The accepted Workbench changed before Record preset preparation began."
    );
  }

  const valuesByNode = new Map<string, ReadonlyMap<string, DcmsValue>>();
  const evaluationsByNode = new Map<string, RecordEvaluation>();
  const summaries: WorkbenchRecordPresetFormSummaryV2[] = [];
  const unavailableForms: WorkbenchRecordPresetUnavailableFormV2[] = [];
  let targetFieldCount = 0;

  for (const form of targetedForms(authority, options.scope)) {
    const fixture = session.formByNode[form.nodeId];
    const model = session.modelByNode[form.nodeId];
    if (!fixture || !model) {
      throw new Error(
        `Accepted session metadata is missing for Form node ${form.nodeId}.`
      );
    }
    const candidate = formCandidate(options.kind, form, fixture, model);
    valuesByNode.set(form.nodeId, cloneFrozenGraph(candidate.values));
    evaluationsByNode.set(form.nodeId, cloneFrozenGraph(candidate.evaluation));
    summaries.push(formSummary(form, candidate.evaluation));
    targetFieldCount += form.definition.fields.length;
    if (candidate.unavailableReason) {
      unavailableForms.push({
        nodeId: form.nodeId,
        title: form.title,
        reason: candidate.unavailableReason
      });
    }
  }

  const available = unavailableForms.length === 0;
  const summary: WorkbenchRecordPresetSummaryV2 = {
    kind: options.kind,
    scope: options.scope,
    available,
    targetFormCount: summaries.length,
    targetFieldCount,
    eligibleFormCount: summaries.filter((form) => form.canSubmit).length,
    blockingFormCount: summaries.filter((form) => form.blockingFieldCount > 0)
      .length,
    warningFormCount: summaries.filter((form) => form.warningFieldCount > 0)
      .length,
    evaluationErrorFormCount: summaries.filter(
      (form) => form.evaluationErrorFieldCount > 0
    ).length,
    preservesOriginalValues: true,
    preservesSeedValues: true,
    preservesRevisionStructure: true,
    forms: summaries,
    unavailableForms
  };

  return freezeOwnedGraph({
    authority,
    kind: options.kind,
    scope: options.scope,
    available,
    valuesByNode,
    evaluationsByNode,
    summary
  });
}

export function createWorkbenchRecordPresetProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  options: {
    readonly kind: WorkbenchRecordPresetKindV2;
    readonly scope: WorkbenchRecordPresetScopeV2;
  }
) {
  return createWorkbenchRecordPresetProposalFromAuthorityV2(
    manager.captureAuthority(),
    options
  );
}

/**
 * Recheck proposal authority and publish all prepared current values through one
 * Workbench-store batch. Original values and reusable seed fixtures are never
 * part of the update.
 */
export function confirmWorkbenchRecordPresetProposalV2(
  manager: WorkbenchRevisionSessionManagerV2,
  proposal: WorkbenchRecordPresetProposalV2
): WorkbenchRecordPresetConfirmationResultV2 {
  const managerSnapshot = manager.getSnapshot();
  const storeSnapshot = managerSnapshot.session.store.getSnapshot();
  if (
    proposal.authority.managerSnapshot !== managerSnapshot ||
    proposal.authority.storeSnapshot !== storeSnapshot
  ) {
    return Object.freeze({
      accepted: false,
      code: "RECORD_PRESET_AUTHORITY_STALE",
      error:
        "The accepted Workbench changed after the Record preset was prepared.",
      managerSnapshot,
      storeSnapshot,
      summary: proposal.summary
    });
  }
  if (!proposal.available) {
    const detail = proposal.summary.unavailableForms
      .map((form) => `${form.title}: ${form.reason}`)
      .join(" ");
    return Object.freeze({
      accepted: false,
      code: "RECORD_PRESET_UNAVAILABLE",
      error:
        `The ${proposal.kind} Record preset is unavailable. ${detail}`.trim(),
      managerSnapshot,
      storeSnapshot,
      summary: proposal.summary
    });
  }

  const updates = Object.fromEntries(
    [...proposal.valuesByNode].map(([nodeId, values]) => [nodeId, values])
  );
  managerSnapshot.session.store.replaceRecordValuesBatch(updates);
  return Object.freeze({
    accepted: true,
    managerSnapshot,
    storeSnapshot: managerSnapshot.session.store.getSnapshot(),
    summary: proposal.summary
  });
}
