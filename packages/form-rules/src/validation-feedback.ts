/** Structured, unit-aware validation-failure feedback. */
import type {
  DcmsValue,
  FieldDefinition,
  ValidationCriteria,
  ValidationFailureDetail,
  ValidationRowDefinition
} from "./types.js";

function text(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function displayValue(value: DcmsValue | string | number | string[]): string {
  if (Array.isArray(value))
    return value.map((item) => displayValue(item)).join(", ");
  if (value === null) return "blank";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function withUnit(value: DcmsValue | string | number, unit?: string): string {
  const displayed = displayValue(value);
  return unit ? `${displayed} ${unit}` : displayed;
}

function lowerInitial(value: string): string {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function sentence(value: string | undefined): string | undefined {
  const normalized = text(value);
  if (!normalized) return undefined;
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function numericExpectation(
  criteria: ValidationCriteria,
  expected: string | number | string[],
  unit?: string
): string | undefined {
  if (Array.isArray(expected)) return undefined;
  const target = withUnit(expected, unit);
  switch (criteria) {
    case "number_less_than":
      return `below ${target}`;
    case "number_greater_than":
      return `above ${target}`;
    case "number_equal_to":
      return `equal to ${target}`;
    default:
      return undefined;
  }
}

/** Build portable evidence for one failed row without inspecting message text. */
export function createValidationFailureDetail(
  field: FieldDefinition,
  row: ValidationRowDefinition,
  enteredValue: DcmsValue,
  calculatedValue: DcmsValue
): ValidationFailureDetail {
  const transformed = !!row.expression?.trim();
  const enteredUnit = text(field.inputUnit);
  const calculatedUnit = transformed ? text(row.resultUnit) : enteredUnit;
  const calculatedLabel = transformed
    ? (text(row.resultLabel) ?? "calculated value")
    : undefined;
  return {
    rowId: row.id,
    rowLabel: row.label ?? row.id,
    enteredValue,
    ...(enteredUnit ? { enteredUnit } : {}),
    calculatedValue,
    ...(calculatedLabel ? { calculatedLabel } : {}),
    ...(calculatedUnit ? { calculatedUnit } : {}),
    criteria: row.criteria,
    expected: Array.isArray(row.keyword) ? [...row.keyword] : row.keyword,
    transformed,
    ...(text(row.failureMessage)
      ? { authoredMessage: text(row.failureMessage)! }
      : {})
  };
}

/**
 * Render deterministic factual feedback. Arbitrary expressions are never
 * algebraically inverted into an entered-value range.
 */
export function formatValidationFailureDetail(
  detail: ValidationFailureDetail,
  fallback: string
): string {
  const introduction = sentence(detail.authoredMessage);
  const expectation = numericExpectation(
    detail.criteria,
    detail.expected,
    detail.calculatedUnit
  );

  let factual: string | undefined;
  if (detail.transformed) {
    const entered = withUnit(detail.enteredValue, detail.enteredUnit);
    const calculated = withUnit(detail.calculatedValue, detail.calculatedUnit);
    const label = lowerInitial(detail.calculatedLabel ?? "calculated value");
    const transformation =
      detail.enteredUnit &&
      detail.calculatedUnit &&
      detail.enteredUnit !== detail.calculatedUnit
        ? `${entered} converts to ${calculated}.`
        : `The entered value ${entered} produces a calculated value of ${calculated}.`;
    factual = expectation
      ? `${transformation} The ${label} must be ${expectation}.`
      : `${transformation} ${fallback}`;
  } else if (expectation && detail.enteredUnit) {
    factual = `The entered value must be ${expectation}.`;
  } else {
    factual = fallback;
  }

  return [introduction, factual].filter(Boolean).join(" ");
}
