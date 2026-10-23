/**
 * Validation-row compilation and execution.
 *
 * Architectural purpose: keep authored rule interpretation out of the keystroke hot path. Values that can be
 * normalized once (numeric thresholds, selection lists, Required Keywords ASTs) are prepared here so React and
 * Express execute the same deterministic rule semantics without reparsing configuration on every change.
 */
import type {
  CompiledValidationRule,
  DcmsValue,
  ValidationCriteria,
  ValidationRuleInput
} from "./types.js";
import { evaluateKeyword, parseKeywordExpression } from "./keyword-parser.js";

function normalizeSelectionValue(
  value: unknown,
  caseSensitive: boolean
): string {
  const text = String(value);
  return caseSensitive ? text : text.toLowerCase();
}

function normalizeSelectedValues(
  value: DcmsValue,
  caseSensitive: boolean
): Set<string> {
  // Checkbox values are sets, not ordered lists. BLANK means no selection, and nested arrays are flattened only
  // because DcmsValue is recursively typed for formula results; duplicate payload values must never affect meaning.
  const out = new Set<string>();
  const visit = (item: DcmsValue): void => {
    if (item === null) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    out.add(normalizeSelectionValue(item, caseSensitive));
  };
  visit(value);
  return out;
}

function isNumericCriteria(criteria: string): boolean {
  return (
    criteria.startsWith("number_") || criteria.startsWith("character_limit_")
  );
}

/**
 * Recognize the supported selection-criterion names, including the legacy include/exclude aliases.
 */
export function isSelectionCriteria(
  criteria: ValidationCriteria | string
): boolean {
  return (
    criteria === "selection_values_include" ||
    criteria === "selection_values_exclude" ||
    criteria === "selection_values_include_any" ||
    criteria === "selection_values_include_all" ||
    criteria === "selection_values_exclude_any" ||
    criteria === "selection_values_exclude_all"
  );
}

/**
 * Normalize already validated rules and prepare keyword ASTs once. The first operator is AND.
 * Use compileForm for untrusted definitions; this helper alone does not perform all authoring checks.
 */
export function compileValidationRules(
  rules: ValidationRuleInput[] = []
): CompiledValidationRule[] {
  return rules.map((rule, index) =>
    compileValidationRule(rule, index === 0 ? "AND" : (rule.operator ?? "AND"))
  );
}

/**
 * Prepare one already validated rule, coercing its threshold and normalizing selection values.
 * Keyword parsing can throw. Use compileForm to reject invalid criteria, operators or thresholds.
 */
export function compileValidationRule(
  rule: ValidationRuleInput,
  operator = rule.operator ?? "AND"
): CompiledValidationRule {
  const caseSensitive = !!rule.caseSensitive;
  const numericKeyword = isNumericCriteria(rule.criteria)
    ? Number(rule.keyword)
    : undefined;
  const selectionValues = isSelectionCriteria(rule.criteria)
    ? [
        ...new Set(
          (Array.isArray(rule.keyword)
            ? rule.keyword
            : [String(rule.keyword)]
          ).map((value) => normalizeSelectionValue(value, caseSensitive))
        )
      ]
    : undefined;

  return {
    operator,
    criteria: rule.criteria,
    keyword: rule.keyword,
    caseSensitive,
    keywordAst:
      rule.criteria === "required_keywords"
        ? parseKeywordExpression(String(rule.keyword))
        : undefined,
    numericKeyword,
    selectionValues
  };
}

function runSelectionRule(
  rule: CompiledValidationRule,
  value: DcmsValue
): { passed: boolean; failure?: string } {
  const configured = rule.selectionValues ?? [];
  const selected = normalizeSelectedValues(value, rule.caseSensitive);
  const anyConfiguredSelected = configured.some((item) => selected.has(item));
  const allConfiguredSelected = configured.every((item) => selected.has(item));

  switch (rule.criteria) {
    // The two legacy names remain useful for scalar Radio controls and preserve the v0.9.1 JSON/API contract.
    // For a multi-value payload they intentionally mean the least-surprising ANY semantics rather than silently
    // inventing an exact-set rule.
    case "selection_values_include":
    case "selection_values_include_any":
      return anyConfiguredSelected
        ? { passed: true }
        : { passed: false, failure: "Select at least one required value" };
    case "selection_values_include_all":
      return allConfiguredSelected
        ? { passed: true }
        : { passed: false, failure: "Select all required values" };
    case "selection_values_exclude":
    case "selection_values_exclude_any":
      return !anyConfiguredSelected
        ? { passed: true }
        : {
            passed: false,
            failure: "One or more excluded values are selected"
          };
    case "selection_values_exclude_all":
      return !allConfiguredSelected
        ? { passed: true }
        : { passed: false, failure: "The excluded combination is selected" };
    default:
      return {
        passed: false,
        failure: "Unsupported selection validation criterion"
      };
  }
}

/**
 * Evaluate one compiled criterion against its supplied value; does not run a row formula.
 * Character counts use JavaScript string length (UTF-16 units). Numeric comparisons are strict
 * less/greater/equal checks; values that cannot meet the numeric contract fail the criterion.
 */
export function runValidationRule(
  rule: CompiledValidationRule,
  value: DcmsValue
): { passed: boolean; failure?: string } {
  if (isSelectionCriteria(rule.criteria)) return runSelectionRule(rule, value);

  const text =
    value == null
      ? ""
      : Array.isArray(value)
        ? value.map(String).join(",")
        : String(value);
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  const threshold = rule.numericKeyword ?? Number(rule.keyword);
  let ok = false;
  let message = "Validation failed";

  switch (rule.criteria) {
    case "required_keywords":
      ok =
        !!rule.keywordAst &&
        evaluateKeyword(rule.keywordAst, text, rule.caseSensitive);
      message = "Required Keywords failed";
      break;
    case "character_limit_less_than":
      ok = text.length < threshold;
      message = `Length must be less than ${rule.keyword}`;
      break;
    case "character_limit_more_than":
      ok = text.length > threshold;
      message = `Length must be more than ${rule.keyword}`;
      break;
    case "character_limit_equal_to":
      ok = text.length === threshold;
      message = `Length must equal ${rule.keyword}`;
      break;
    case "number_greater_than":
      ok = Number.isFinite(numberValue) && numberValue > threshold;
      message = `Value must be greater than ${rule.keyword}`;
      break;
    case "number_less_than":
      ok = Number.isFinite(numberValue) && numberValue < threshold;
      message = `Value must be less than ${rule.keyword}`;
      break;
    case "number_equal_to":
      ok = Number.isFinite(numberValue) && numberValue === threshold;
      message = `Value must equal ${rule.keyword}`;
      break;
  }
  return ok ? { passed: true } : { passed: false, failure: message };
}

function isOrFamily(operator: CompiledValidationRule["operator"]): boolean {
  return operator === "OR" || operator === "OR NOT";
}

function isNegated(operator: CompiledValidationRule["operator"]): boolean {
  return operator === "AND NOT" || operator === "OR NOT";
}

/**
 * Combine independent validation-row Boolean results using DCMS Boolean precedence rather than row-by-row mutation.
 * This separation is important: each row is pure and field-scoped, while the authored operators define a Boolean
 * expression. NOT binds to its row operand, AND-family operations bind before OR-family operations.
 *
 * Example: A OR B AND C OR D AND NOT E => A OR (B AND C) OR (D AND (NOT E)).
 */
export function combineValidationRowResults(
  rules: readonly CompiledValidationRule[],
  results: readonly boolean[]
): boolean {
  if (!rules.length) return true;

  let currentAndGroup = results[0] ?? false;
  let completedOrGroups = false;

  for (let index = 1; index < rules.length; index++) {
    const operator = rules[index].operator;
    const raw = results[index] ?? false;
    const operand = isNegated(operator) ? !raw : raw;

    if (isOrFamily(operator)) {
      completedOrGroups = completedOrGroups || currentAndGroup;
      currentAndGroup = operand;
    } else {
      currentAndGroup = currentAndGroup && operand;
    }
  }

  return completedOrGroups || currentAndGroup;
}

function effectiveRowPassed(
  rule: CompiledValidationRule,
  rawPassed: boolean,
  index: number
): boolean {
  if (index === 0) return rawPassed;
  return isNegated(rule.operator) ? !rawPassed : rawPassed;
}

/**
 * Apply all compiled rules to the same value, combine their Boolean results and collect failures.
 * For modern rows with distinct formula results, use evaluateRecord instead. No rules passes.
 */
export function runValidationRules(
  rules: CompiledValidationRule[],
  value: DcmsValue
): { passed: boolean; failures: string[] } {
  if (!rules.length) return { passed: true, failures: [] };
  const evaluations = rules.map((rule) => runValidationRule(rule, value));
  const rawResults = evaluations.map((result) => result.passed);
  const passed = combineValidationRowResults(rules, rawResults);
  if (passed) return { passed: true, failures: [] };

  const failures: string[] = [];
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const rawPassed = rawResults[index] ?? false;
    if (effectiveRowPassed(rule, rawPassed, index)) continue;

    if (index > 0 && isNegated(rule.operator) && rawPassed) {
      failures.push(
        `Validation row ${index + 1}: ${rule.operator} condition matched; NOT makes this row operand FALSE.`
      );
    } else {
      failures.push(
        evaluations[index].failure ?? `Validation row ${index + 1} failed.`
      );
    }
  }
  if (!failures.length)
    failures.push(
      "Combined validation result failed after applying NOT > AND > OR precedence."
    );
  return { passed: false, failures };
}
