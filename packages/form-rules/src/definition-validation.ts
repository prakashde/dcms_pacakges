/**
 * Form-definition authoring validation.
 *
 * Architectural purpose: reject ambiguous or internally inconsistent rule definitions before a compiled plan is
 * admitted to either the browser or server runtime. Runtime evaluation should deal with user values, not discover
 * authoring defects that could otherwise diverge between React and Express.
 */
import type {
  FormDefinition,
  ValidationCriteria,
  ValidationRuleInput,
  ValidationRowDefinition,
  RowOperator
} from "./types.js";
import { diagnoseKeywordExpression } from "./diagnostics.js";
import { prepareFormula } from "./formula-evaluator.js";
import { findRuleConflicts } from "./rule-conflicts.js";
import { assertFormShape } from "./boundaries.js";
import { isSelectionCriteria } from "./validation.js";

export interface DefinitionIssue {
  fieldId: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

const VALID_CRITERIA = new Set<ValidationCriteria>([
  "required_keywords",
  "character_limit_less_than",
  "character_limit_more_than",
  "character_limit_equal_to",
  "number_greater_than",
  "number_less_than",
  "number_equal_to",
  "selection_values_include",
  "selection_values_exclude",
  "selection_values_include_any",
  "selection_values_include_all",
  "selection_values_exclude_any",
  "selection_values_exclude_all"
]);
const VALID_OPERATORS = new Set<RowOperator>([
  "AND",
  "OR",
  "AND NOT",
  "OR NOT"
]);
const VALID_VALUE_TYPES = new Set(["number", "string", "boolean"]);

function normalizedSelectionValues(rule: ValidationRuleInput): string[] {
  const raw = Array.isArray(rule.keyword)
    ? rule.keyword.map(String)
    : [String(rule.keyword ?? "")];
  return raw
    .filter((value) => value.trim() !== "")
    .map((value) => (rule.caseSensitive ? value : value.toLowerCase()));
}

function checkValidation(
  fieldId: string,
  r: ValidationRuleInput,
  index: string,
  issues: DefinitionIssue[]
): void {
  // TypeScript protects package authors, but Form definitions also arrive from JSON/database boundaries. Rejecting
  // unknown operator/criterion names here prevents a typo from silently becoming a false validation result.
  if (!VALID_CRITERIA.has(r.criteria as ValidationCriteria)) {
    issues.push({
      fieldId,
      code: `CRITERIA-${index}`,
      severity: "error",
      message: `Unsupported validation criterion ${String(r.criteria)}.`
    });
    return;
  }
  if (
    r.operator !== undefined &&
    !VALID_OPERATORS.has(r.operator as RowOperator)
  ) {
    issues.push({
      fieldId,
      code: `OPERATOR-${index}`,
      severity: "error",
      message: `Unsupported validation operator ${String(r.operator)}.`
    });
  }
  if (r.criteria === "required_keywords") {
    const d = diagnoseKeywordExpression(String(r.keyword ?? ""));
    if (d.state !== "valid")
      issues.push({
        fieldId,
        code: `KW-${index}`,
        severity: "error",
        message: d.message ?? "Invalid Required Keywords expression."
      });
    else
      for (const w of d.warnings ?? [])
        issues.push({
          fieldId,
          code: `${w.code}-${index}`,
          severity: "warning",
          message: w.message
        });
  }
  if (
    r.criteria.startsWith("number_") ||
    r.criteria.startsWith("character_limit_")
  ) {
    // Number("") is 0 in JavaScript. Treat blank criteria as authoring errors so an empty UI cell can never
    // accidentally become a real zero threshold in the browser/server runtime.
    const raw = typeof r.keyword === "string" ? r.keyword.trim() : r.keyword;
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n))
      issues.push({
        fieldId,
        code: `NUM-${index}`,
        severity: "error",
        message: "Numeric validation requires a valid number."
      });
    else if (
      r.criteria.startsWith("character_limit_") &&
      (!Number.isInteger(n) || n < 0)
    ) {
      issues.push({
        fieldId,
        code: `CHAR-LIMIT-${index}`,
        severity: "error",
        message:
          "Character-limit validation requires a whole number greater than or equal to 0."
      });
    }
  }
  if (isSelectionCriteria(r.criteria)) {
    const list = normalizedSelectionValues(r);
    if (!list.length)
      issues.push({
        fieldId,
        code: `SEL-${index}`,
        severity: "error",
        message: "At least one non-blank selection value is required."
      });
    if (new Set(list).size !== list.length)
      issues.push({
        fieldId,
        code: `SEL-DUP-${index}`,
        severity: "warning",
        message:
          "Selection values contain duplicates under the configured case-sensitivity rule."
      });
  }
}

function normalizedRows(
  f: FormDefinition["fields"][number]
): ValidationRowDefinition[] {
  if (f.validationRows?.length) return f.validationRows;
  if (f.formulaValidations?.length)
    return f.formulaValidations.map((p, i) => ({
      id: p.id,
      label: p.label,
      expression: p.expression,
      operator: i === 0 ? "AND" : (p.validation.operator ?? "AND"),
      criteria: p.validation.criteria,
      keyword: p.validation.keyword,
      caseSensitive: p.validation.caseSensitive
    }));
  return [];
}

function isPureAndChain(
  rules: readonly ValidationRuleInput[] | undefined
): boolean {
  return (
    !!rules?.length &&
    rules.every(
      (rule, index) => index === 0 || !rule.operator || rule.operator === "AND"
    )
  );
}

/**
 * Collect structural and semantic authoring issues without compiling a reusable plan.
 * Malformed shapes return an error issue. Warnings remain advisory; compileForm rejects
 * error-severity issues. This does not establish validity of future Record values.
 */
export function validateFormDefinition(def: FormDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const fieldIds = new Set<string>();
  try {
    assertFormShape(def);
  } catch (e) {
    return [
      {
        fieldId: "(form)",
        code: "DEFINITION-SHAPE",
        severity: "error",
        message: e instanceof Error ? e.message : String(e)
      }
    ];
  }
  if (!def.formId?.trim())
    issues.push({
      fieldId: "(form)",
      code: "FORM-ID-MISSING",
      severity: "error",
      message: "Form ID is required."
    });
  for (const f of def.fields) {
    if (!f.id?.trim())
      issues.push({
        fieldId: "(missing)",
        code: "FIELD-ID-MISSING",
        severity: "error",
        message: "Field ID is required."
      });
    if (fieldIds.has(f.id))
      issues.push({
        fieldId: f.id,
        code: "FIELD-ID-DUP",
        severity: "error",
        message: `Duplicate field ID ${f.id}.`
      });
    fieldIds.add(f.id);
    if (!VALID_VALUE_TYPES.has(f.valueType as string))
      issues.push({
        fieldId: f.id || "(missing)",
        code: "FIELD-VALUE-TYPE",
        severity: "error",
        message: `Unsupported field valueType ${String(f.valueType)}.`
      });

    // Legacy field formulas remain accepted for migration, but new definitions should prefer row-scoped expressions.
    if (
      f.expression?.trim() &&
      !f.validationRows?.length &&
      !f.formulaValidations?.length
    ) {
      try {
        prepareFormula(f.expression);
      } catch (e) {
        issues.push({
          fieldId: f.id,
          code: "FORMULA-PARSE",
          severity: "error",
          message: e instanceof Error ? e.message : String(e)
        });
      }
    }
    (f.validations ?? []).forEach((r, i) =>
      checkValidation(f.id, r, String(i + 1), issues)
    );
    // Conflict inference is only sound for AND-only rules. OR/NOT can intentionally make two individually
    // contradictory-looking thresholds satisfiable, so those definitions are left to normal Boolean evaluation.
    if (!f.expression?.trim() && isPureAndChain(f.validations))
      for (const c of findRuleConflicts(f.validations))
        issues.push({
          fieldId: f.id,
          code: c.code,
          severity: "error",
          message: c.message
        });

    const rows = normalizedRows(f);
    const rowIds = new Set<string>();
    rows.forEach((r, i) => {
      if (!r.id?.trim())
        issues.push({
          fieldId: f.id,
          code: `ROW-ID-${i + 1}`,
          severity: "error",
          message: "Validation row ID is required."
        });
      else if (rowIds.has(r.id))
        issues.push({
          fieldId: f.id,
          code: `ROW-ID-DUP-${r.id}`,
          severity: "error",
          message: `Duplicate validation row ID ${r.id}.`
        });
      rowIds.add(r.id);
      if (r.expression?.trim()) {
        try {
          prepareFormula(r.expression);
        } catch (e) {
          issues.push({
            fieldId: f.id,
            code: `ROW-FORMULA-${r.id || i + 1}`,
            severity: "error",
            message: e instanceof Error ? e.message : String(e)
          });
        }
      }
      checkValidation(f.id, r, `ROW-${r.id || i + 1}`, issues);
    });

    // Cross-row conflict checks intentionally stop at direct AND chains on the same entered value. Expressions,
    // OR, and NOT change the logical domain enough that static "impossible range" claims would be unsafe.
    if (
      rows.length &&
      rows.every(
        (r, i) =>
          !r.expression?.trim() &&
          (i === 0 || !r.operator || r.operator === "AND")
      )
    ) {
      for (const c of findRuleConflicts(rows))
        issues.push({
          fieldId: f.id,
          code: c.code,
          severity: "error",
          message: c.message
        });
    }
  }
  return issues;
}
