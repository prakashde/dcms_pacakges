/** Headless authoring policy/diagnostics shared by the React ValidationRowEditor. */
import {
  diagnoseFormula,
  diagnoseKeywordExpression,
  type ValidationCriteria,
  type ValidationRowDefinition
} from "@dcms/form-rules";
import type { WorkbenchFieldCategory } from "./contracts.js";

export interface CriteriaOption {
  value: ValidationCriteria;
  label: string;
}

const REQUIRED_KEYWORD_CRITERIA: readonly CriteriaOption[] = [
  { value: "required_keywords", label: "Required Keywords" }
];
const CHARACTER_CRITERIA: readonly CriteriaOption[] = [
  { value: "character_limit_less_than", label: "Character Limit Less Than" },
  { value: "character_limit_more_than", label: "Character Limit More Than" },
  { value: "character_limit_equal_to", label: "Character Limit Equal To" }
];
const NUMBER_CRITERIA: readonly CriteriaOption[] = [
  { value: "number_greater_than", label: "Number Greater Than" },
  { value: "number_less_than", label: "Number Less Than" },
  { value: "number_equal_to", label: "Number Equal To" }
];
const RADIO_SELECTION_CRITERIA: readonly CriteriaOption[] = [
  { value: "selection_values_include", label: "Selection Values Include" },
  { value: "selection_values_exclude", label: "Selection Values Exclude" }
];
const CHECKBOX_SELECTION_CRITERIA: readonly CriteriaOption[] = [
  {
    value: "selection_values_include_any",
    label: "Selection Values Include Any"
  },
  {
    value: "selection_values_include_all",
    label: "Selection Values Include All"
  },
  {
    value: "selection_values_exclude_any",
    label: "Selection Values Exclude Any"
  },
  {
    value: "selection_values_exclude_all",
    label: "Selection Values Exclude All"
  }
];

export function criteriaForWorkbenchCategory(
  category: WorkbenchFieldCategory
): readonly CriteriaOption[] {
  if (category === "Checkbox") {
    return [...REQUIRED_KEYWORD_CRITERIA, ...CHECKBOX_SELECTION_CRITERIA];
  }
  if (category === "Radio") {
    return [...REQUIRED_KEYWORD_CRITERIA, ...RADIO_SELECTION_CRITERIA];
  }
  if (category === "Text" || category === "Rich Text") {
    return [...REQUIRED_KEYWORD_CRITERIA, ...CHARACTER_CRITERIA];
  }
  return [
    ...REQUIRED_KEYWORD_CRITERIA,
    ...CHARACTER_CRITERIA,
    ...NUMBER_CRITERIA
  ];
}

export function criterionAllowedForWorkbenchCategory(
  category: WorkbenchFieldCategory,
  criterion: ValidationCriteria
) {
  return criteriaForWorkbenchCategory(category).some(
    (item) => item.value === criterion
  );
}

export function normalizeValidationRowsForCategory(
  rows: readonly ValidationRowDefinition[],
  category: WorkbenchFieldCategory
): ValidationRowDefinition[] {
  return rows.map((row) =>
    criterionAllowedForWorkbenchCategory(category, row.criteria)
      ? cloneValidationRow(row)
      : {
          ...cloneValidationRow(row),
          criteria: "required_keywords",
          keyword: "PASS",
          caseSensitive: false
        }
  );
}

export interface ValidationRowDiagnostics {
  formulaState: "none" | "valid" | "incomplete" | "invalid";
  formulaMessage: string;
  criterionState: "valid" | "incomplete" | "invalid";
  criterionMessage: string;
  warnings: string[];
  blockingIssueCount: number;
}

export function getValidationRowDiagnostics(
  row: ValidationRowDefinition
): ValidationRowDiagnostics {
  let formulaState: ValidationRowDiagnostics["formulaState"] = "none";
  let formulaMessage = "";
  let blockingIssueCount = 0;
  const warnings: string[] = [];

  if (row.expression) {
    const diagnosis = diagnoseFormula(row.expression);
    formulaState = diagnosis.state;
    formulaMessage =
      diagnosis.state === "valid"
        ? "Formula syntax valid"
        : diagnosis.message || diagnosis.state;
    if (diagnosis.state !== "valid") blockingIssueCount++;
  }

  let criterionState: ValidationRowDiagnostics["criterionState"] = "valid";
  let criterionMessage = "";
  if (row.criteria === "required_keywords") {
    const diagnosis = diagnoseKeywordExpression(String(row.keyword ?? ""));
    criterionState = diagnosis.state;
    warnings.push(
      ...(diagnosis.warnings ?? []).map((warning) => warning.message)
    );
    criterionMessage =
      diagnosis.state === "valid"
        ? warnings.join(" ") || "Keyword syntax valid"
        : diagnosis.message || diagnosis.state;
    if (diagnosis.state !== "valid") blockingIssueCount++;
  } else if (
    row.criteria.startsWith("number_") ||
    row.criteria.startsWith("character_limit_")
  ) {
    const good =
      typeof row.keyword === "number" && Number.isFinite(row.keyword);
    criterionState = good ? "valid" : "invalid";
    criterionMessage = good ? "Numeric criterion" : "Enter a finite number";
    if (!good) blockingIssueCount++;
  } else {
    const values = Array.isArray(row.keyword) ? row.keyword : [];
    const good = values.length > 0 && values.every((value) => value.length > 0);
    criterionState = good ? "valid" : "invalid";
    criterionMessage = good
      ? "Selection values are preserved as separate literals"
      : "Enter at least one selection value";
    if (!good) blockingIssueCount++;
  }

  return {
    formulaState,
    formulaMessage,
    criterionState,
    criterionMessage,
    warnings,
    blockingIssueCount
  };
}

export function summarizeValidationRows(
  rows: readonly ValidationRowDefinition[]
) {
  let blockingIssueCount = 0;
  let warningCount = 0;
  for (const row of rows) {
    const diagnosis = getValidationRowDiagnostics(row);
    blockingIssueCount += diagnosis.blockingIssueCount;
    warningCount += diagnosis.warnings.length;
  }
  return { blockingIssueCount, warningCount };
}

export function nextValidationRowId(
  fieldId: string,
  rows: readonly ValidationRowDefinition[]
) {
  const used = new Set(rows.map((row) => row.id));
  let index = 1;
  while (used.has(`${fieldId}_vr_${String(index).padStart(2, "0")}`)) index++;
  return `${fieldId}_vr_${String(index).padStart(2, "0")}`;
}

export function cloneValidationRow(
  row: ValidationRowDefinition
): ValidationRowDefinition {
  return {
    ...row,
    keyword: Array.isArray(row.keyword) ? [...row.keyword] : row.keyword
  };
}
