/**
 * Compile-time acceptable-input guidance.
 *
 * Architectural purpose: the rules engine should explain the same semantics that it enforces, while remaining
 * presentation-neutral. Guidance is derived from compiled rules so React does not duplicate validation logic or
 * attempt unsafe algebraic inversion of transformed formulas.
 */
import type {
  CompiledField,
  CompiledValidationRow,
  FieldInputGuidance,
  NumericInputRange,
  SelectionInputRequirement,
  TextLengthInputRange,
  ValidationCriteria
} from "./types.js";
import { isSelectionCriteria } from "./validation.js";

function isIdentityLegacyFormula(
  field: Pick<CompiledField, "legacyFormula">
): boolean {
  return !field.legacyFormula || field.legacyFormula.root.kind === "value";
}

function rowUsesEnteredValue(
  field: Pick<CompiledField, "legacyFormula">,
  row: CompiledValidationRow
): boolean {
  // A row expression owns its VALUE input. Legacy field-wide expressions are supported only for compatibility,
  // so guidance treats them as transformed unless the prepared formula is literally VALUE.
  if (row.formula) return row.formula.root.kind === "value";
  return isIdentityLegacyFormula(field);
}

function formatValue(value: string | number | string[]): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function valueWithUnit(
  value: string | number | string[],
  unit?: string
): string {
  const displayed = formatValue(value);
  const normalizedUnit = unit?.trim();
  return normalizedUnit ? `${displayed} ${normalizedUnit}` : displayed;
}

function criterionFragment(
  criteria: ValidationCriteria,
  keyword: string | number | string[],
  options: { subject?: string; unit?: string } = {}
): string {
  const subject = options.subject ?? "value";
  const numericValue = valueWithUnit(keyword, options.unit);
  switch (criteria) {
    case "number_greater_than":
      return `${subject} > ${numericValue}`;
    case "number_less_than":
      return `${subject} < ${numericValue}`;
    case "number_equal_to":
      return `${subject} = ${numericValue}`;
    case "character_limit_less_than":
      return `length < ${formatValue(keyword)}`;
    case "character_limit_more_than":
      return `length > ${formatValue(keyword)}`;
    case "character_limit_equal_to":
      return `length = ${formatValue(keyword)}`;
    case "selection_values_include":
      return `allowed selection: ${formatValue(keyword)}`;
    case "selection_values_exclude":
      return `excluded selection: ${formatValue(keyword)}`;
    case "selection_values_include_any":
      return `include any: ${formatValue(keyword)}`;
    case "selection_values_include_all":
      return `include all: ${formatValue(keyword)}`;
    case "selection_values_exclude_any":
      return `exclude any: ${formatValue(keyword)}`;
    case "selection_values_exclude_all":
      return `exclude all together: ${formatValue(keyword)}`;
    case "required_keywords":
      return `Required Keywords: ${formatValue(keyword)}`;
  }
}

/**
 * Describe one authored criterion for display; this does not validate a definition or invert a formula.
 */
export function describeValidationCriterion(
  criteria: ValidationCriteria,
  keyword: string | number | string[]
): string {
  return criterionFragment(criteria, keyword);
}

function joinAuthoredCriteria(
  field: Pick<CompiledField, "definition" | "legacyFormula">,
  rows: readonly CompiledValidationRow[]
): string {
  return rows
    .map((row, index) => {
      const direct = rowUsesEnteredValue(field, row);
      const subject = direct
        ? "value"
        : row.definition.resultLabel?.trim() || "calculated value";
      const unit = direct
        ? field.definition.inputUnit
        : row.definition.resultUnit;
      const part = criterionFragment(
        row.validation.criteria,
        row.validation.keyword,
        { subject, unit }
      );
      return index === 0 ? part : `${row.validation.operator} ${part}`;
    })
    .join("; ");
}

function numericRange(
  rows: readonly CompiledValidationRow[]
): NumericInputRange {
  const lowers = rows
    .filter((row) => row.validation.criteria === "number_greater_than")
    .map((row) => Number(row.validation.keyword))
    .filter(Number.isFinite);
  const uppers = rows
    .filter((row) => row.validation.criteria === "number_less_than")
    .map((row) => Number(row.validation.keyword))
    .filter(Number.isFinite);
  const equals = rows
    .filter((row) => row.validation.criteria === "number_equal_to")
    .map((row) => Number(row.validation.keyword))
    .filter(Number.isFinite);

  const range: NumericInputRange = {};
  if (equals.length) range.equalTo = equals[0];
  if (lowers.length)
    range.lower = { value: Math.max(...lowers), inclusive: false };
  if (uppers.length)
    range.upper = { value: Math.min(...uppers), inclusive: false };
  return range;
}

function numericRangeDisplay(range: NumericInputRange, unit?: string): string {
  const display = (value: number) => valueWithUnit(value, unit);
  if (range.equalTo !== undefined)
    return `Accepted input: = ${display(range.equalTo)}`;
  const parts: string[] = [];
  if (range.lower)
    parts.push(
      `${range.lower.inclusive ? "≥" : ">"} ${display(range.lower.value)}`
    );
  if (range.upper)
    parts.push(
      `${range.upper.inclusive ? "≤" : "<"} ${display(range.upper.value)}`
    );
  return `Accepted input: ${parts.join(" and ")}`;
}

function textLengthRange(
  rows: readonly CompiledValidationRow[]
): TextLengthInputRange {
  const mins = rows
    .filter((row) => row.validation.criteria === "character_limit_more_than")
    .map((row) => Number(row.validation.keyword))
    .filter(Number.isFinite);
  const maxes = rows
    .filter((row) => row.validation.criteria === "character_limit_less_than")
    .map((row) => Number(row.validation.keyword))
    .filter(Number.isFinite);
  const equals = rows
    .filter((row) => row.validation.criteria === "character_limit_equal_to")
    .map((row) => Number(row.validation.keyword))
    .filter(Number.isFinite);

  const range: TextLengthInputRange = {};
  if (equals.length) range.equalTo = equals[0];
  if (mins.length) range.minExclusive = Math.max(...mins);
  if (maxes.length) range.maxExclusive = Math.min(...maxes);
  return range;
}

function textLengthDisplay(range: TextLengthInputRange): string {
  if (range.equalTo !== undefined)
    return `Accepted text length: = ${range.equalTo}`;
  const parts: string[] = [];
  if (range.minExclusive !== undefined) parts.push(`> ${range.minExclusive}`);
  if (range.maxExclusive !== undefined) parts.push(`< ${range.maxExclusive}`);
  return `Accepted text length: ${parts.join(" and ")}`;
}

function selectionMode(
  criteria: ValidationCriteria
): SelectionInputRequirement["mode"] | undefined {
  switch (criteria) {
    case "selection_values_include":
    case "selection_values_include_any":
      return "include_any";
    case "selection_values_include_all":
      return "include_all";
    case "selection_values_exclude":
    case "selection_values_exclude_any":
      return "exclude_any";
    case "selection_values_exclude_all":
      return "exclude_all";
    default:
      return undefined;
  }
}

function selectionRequirementDisplay(
  requirement: SelectionInputRequirement
): string {
  const values = requirement.values.join(", ");
  switch (requirement.mode) {
    case "include_any":
      return `Select at least one of: ${values}`;
    case "include_all":
      return `Select all of: ${values}`;
    case "exclude_any":
      return `Do not select any of: ${values}`;
    case "exclude_all":
      return `Do not select all together: ${values}`;
  }
}

function selectionGuidance(
  rows: readonly CompiledValidationRow[]
): Pick<
  FieldInputGuidance,
  "allowedValues" | "excludedValues" | "selectionRequirements" | "display"
> {
  const requirements: SelectionInputRequirement[] = rows.map((row) => ({
    mode: selectionMode(row.validation.criteria)!,
    values: Array.isArray(row.validation.keyword)
      ? row.validation.keyword.map(String)
      : [String(row.validation.keyword)],
    caseSensitive: row.validation.caseSensitive
  }));

  // Keep the older convenience fields only when they can be represented without losing ANY/ALL meaning.
  // Consumers that need complete Checkbox semantics should use selectionRequirements.
  const includeAny = requirements.filter((item) => item.mode === "include_any");
  const includeAll = requirements.filter((item) => item.mode === "include_all");
  const excludeAny = requirements.filter((item) => item.mode === "exclude_any");
  const excludeAll = requirements.filter((item) => item.mode === "exclude_all");
  const allowedValues =
    includeAny.length === 1 && includeAll.length === 0
      ? [...includeAny[0].values]
      : undefined;
  const excludedValues =
    excludeAny.length > 0 && excludeAll.length === 0
      ? [...new Set(excludeAny.flatMap((item) => item.values))]
      : undefined;

  return {
    allowedValues,
    excludedValues,
    selectionRequirements: requirements,
    display:
      requirements.map(selectionRequirementDisplay).join("; ") ||
      "Selection validation applies"
  };
}

/**
 * Build UI-neutral guidance for one field. Only direct AND-composed constraints are collapsed into a range/set
 * because those transformations are guaranteed to preserve meaning. OR/NOT and calculated-value rules remain a
 * faithful criteria summary rather than a misleading "acceptable range" guess.
 */
export function buildFieldInputGuidance(
  field: Pick<CompiledField, "definition" | "validationRows" | "legacyFormula">
): FieldInputGuidance {
  const rows = field.validationRows;
  const rowIds = rows.map((row) => row.definition.id);
  if (!rows.length) {
    return {
      kind: "none",
      appliesTo: "entered_value",
      display: "No validation applied",
      complete: true,
      rowIds
    };
  }

  const direct = rows.every((row) => rowUsesEnteredValue(field, row));
  const allAnd = rows.every(
    (row, index) => index === 0 || row.validation.operator === "AND"
  );

  if (
    direct &&
    allAnd &&
    rows.every((row) => row.validation.criteria.startsWith("number_"))
  ) {
    const range = numericRange(rows);
    return {
      kind: "numeric_range",
      appliesTo: "entered_value",
      display: numericRangeDisplay(range, field.definition.inputUnit),
      complete: true,
      rowIds,
      numericRange: range
    };
  }

  if (
    direct &&
    allAnd &&
    rows.every((row) => row.validation.criteria.startsWith("character_limit_"))
  ) {
    const range = textLengthRange(rows);
    return {
      kind: "text_length",
      appliesTo: "entered_value",
      display: textLengthDisplay(range),
      complete: true,
      rowIds,
      textLength: range
    };
  }

  if (
    direct &&
    allAnd &&
    rows.every((row) => isSelectionCriteria(row.validation.criteria)) &&
    rows.every(
      (row) => row.validation.caseSensitive === rows[0].validation.caseSensitive
    )
  ) {
    const selection = selectionGuidance(rows);
    return {
      kind: "selection",
      appliesTo: "entered_value",
      display: selection.display,
      complete: true,
      rowIds,
      allowedValues: selection.allowedValues,
      excludedValues: selection.excludedValues,
      selectionRequirements: selection.selectionRequirements
    };
  }

  if (
    direct &&
    allAnd &&
    rows.every((row) => row.validation.criteria === "required_keywords")
  ) {
    const expressions = rows.map((row) => String(row.validation.keyword));
    return {
      kind: "required_keywords",
      appliesTo: "entered_value",
      display: `Required Keywords: ${expressions.map((expression) => `(${expression})`).join(" AND ")}`,
      complete: true,
      rowIds,
      keywordExpressions: expressions
    };
  }

  const directFlags = rows.map((row) => rowUsesEnteredValue(field, row));
  const appliesTo = directFlags.every(Boolean)
    ? "entered_value"
    : directFlags.every((value) => !value)
      ? "calculated_value"
      : "mixed";
  const prefix =
    appliesTo === "entered_value"
      ? "Accepted criteria"
      : appliesTo === "calculated_value"
        ? "Calculated-value criteria"
        : "Entered/calculated criteria";

  return {
    kind: "criteria_summary",
    appliesTo,
    display: `${prefix}: ${joinAuthoredCriteria(field, rows)}`,
    complete: true,
    rowIds
  };
}

/**
 * Return the guidance attached during compilation without recomputation or cloning; treat it as read-only.
 */
export function getCompiledFieldInputGuidance(
  field: CompiledField
): FieldInputGuidance {
  return field.inputGuidance;
}
