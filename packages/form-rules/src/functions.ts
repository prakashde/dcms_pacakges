/**
 * DCMS-controlled function registry over Formula.js.
 *
 * Why this exists: Formula.js is an implementation library, not the language authority. The registry applies the
 * allow/pending/exclude policy, provides stable function IDs, and supplies DCMS-native lazy functions where evaluation
 * order matters.
 */
import * as FormulaJS from "@formulajs/formulajs";
import type {
  DcmsValue,
  FormulaEvaluationContext,
  PreparedFormulaNode
} from "./types.js";
import { DcmsRuleError } from "./errors.js";
import {
  DCMS_FORMULA_COMPILER_VERSION,
  DCMS_FORMULA_LANGUAGE_VERSION,
  DCMS_FORMULA_REGISTRY_VERSION,
  FORMULAJS_4_6_1_FUNCTIONS,
  FORMULAJS_VERSION,
  formulaJsPolicyStatus,
  type FormulaJsPolicyStatus
} from "./formulajs-policy.js";
import { assertDcmsValue } from "./boundaries.js";
import { guardFunctionArguments, substitute } from "./function-guards.js";
import { compatibilityHash64 } from "./compatibility.js";

export type FunctionEvaluationMode = "eager" | "lazy";
export interface FunctionRegistryEntry {
  id: number;
  name: string;
  status: FormulaJsPolicyStatus | "dcms_specific";
  evaluationMode: FunctionEvaluationMode;
  source: "formulajs" | "dcms";
  implementation?: (...args: any[]) => unknown;
}

const formulaNamespace = FormulaJS as unknown as Record<string, unknown>;
function resolveFormulaJsFunction(
  name: string
): ((...args: any[]) => unknown) | undefined {
  let current: unknown = formulaNamespace;
  for (const part of name.split(".")) {
    const traversable =
      typeof current === "object" || typeof current === "function";
    if (
      !current ||
      !traversable ||
      !Object.prototype.hasOwnProperty.call(current, part)
    )
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "function"
    ? (current as (...args: any[]) => unknown)
    : undefined;
}

const customNames = [
  "FIELD",
  "COALESCE",
  "CONTAINS",
  "STARTSWITH",
  "ENDSWITH",
  "TO_NUMBER",
  "TO_TEXT"
] as const;
const formulaNames = [...FORMULAJS_4_6_1_FUNCTIONS].sort();
const allNames = [
  ...formulaNames,
  ...customNames.filter((x) => !formulaNames.includes(x as any))
].sort();

const registryEntries: FunctionRegistryEntry[] = allNames.map((name, id) => {
  const custom = (customNames as readonly string[]).includes(name);
  const status = custom ? "dcms_specific" : formulaJsPolicyStatus(name);
  const evaluationMode: FunctionEvaluationMode = [
    "IF",
    "IFS",
    "SWITCH",
    "CHOOSE",
    "AND",
    "OR",
    "NOT",
    "COALESCE"
  ].includes(name)
    ? "lazy"
    : "eager";
  return {
    id,
    name,
    status,
    evaluationMode,
    source: custom || status === "dcms_implemented" ? "dcms" : "formulajs",
    implementation:
      !custom && status === "supported"
        ? resolveFormulaJsFunction(name)
        : undefined
  };
});
for (const entry of registryEntries) Object.freeze(entry);
Object.freeze(registryEntries);
const byName = new Map(registryEntries.map((e) => [e.name, e]));
const byId = new Map(registryEntries.map((e) => [e.id, e]));

export const FUNCTION_REGISTRY =
  registryEntries as readonly FunctionRegistryEntry[];
export const FORMULA_LANGUAGE_VERSION = DCMS_FORMULA_LANGUAGE_VERSION;
export const FORMULA_COMPILER_VERSION = DCMS_FORMULA_COMPILER_VERSION;
export const FORMULA_REGISTRY_VERSION = DCMS_FORMULA_REGISTRY_VERSION;
export { FORMULAJS_VERSION };

const registryFingerprintSource = registryEntries
  .map(
    (entry) =>
      `${entry.name}|${entry.status}|${entry.evaluationMode}|${entry.source}`
  )
  .join("\n");
/** Content fingerprint: function names, policy statuses, evaluation modes and implementation source. */
export const FUNCTION_REGISTRY_FINGERPRINT = `dcms-registry:${FORMULA_REGISTRY_VERSION}:${compatibilityHash64(registryFingerprintSource)}`;

/**
 * Resolve a case-insensitive name and enforce availability policy. Unknown, excluded or
 * pending functions throw controlled errors; supported upstream entries require an implementation.
 */
export function getFunctionRegistryEntry(name: string): FunctionRegistryEntry {
  const normalized = name.toUpperCase();
  const entry = byName.get(normalized);
  if (!entry)
    throw new DcmsRuleError(
      "FORMULA_UNKNOWN_FUNCTION",
      `Unknown formula function ${name}.`,
      { functionName: normalized }
    );
  if (entry.status === "excluded_nondeterministic")
    throw new DcmsRuleError(
      "FORMULA_UNSUPPORTED_FUNCTION",
      `${normalized} is excluded because its result depends on hidden time/random state.`,
      { functionName: normalized }
    );
  if (entry.status === "pending_date_semantics")
    throw new DcmsRuleError(
      "FORMULA_DATE_TIME_UNSUPPORTED",
      `${normalized} is not exposed until DCMS date representation is defined.`,
      { functionName: normalized }
    );
  if (entry.status === "excluded_spreadsheet_context")
    throw new DcmsRuleError(
      "FORMULA_UNSUPPORTED_FUNCTION",
      `${normalized} requires implicit spreadsheet coordinates that DCMS does not define.`,
      { functionName: normalized }
    );
  if (entry.status === "pending_error_value_semantics")
    throw new DcmsRuleError(
      "FORMULA_UNSUPPORTED_FUNCTION",
      `${normalized} is not exposed until DCMS formula error-value semantics are defined.`,
      { functionName: normalized }
    );
  if (
    entry.status === "pending_environment_semantics" ||
    entry.status === "pending_unsafe_semantics"
  )
    throw new DcmsRuleError(
      "FORMULA_UNSUPPORTED_FUNCTION",
      `${normalized} is pending deterministic and safe DCMS lookup semantics.`,
      { functionName: normalized }
    );
  if (entry.status === "supported" && !entry.implementation)
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `${normalized} is listed by the pinned Formula.js catalog but its implementation could not be resolved.`,
      { functionName: normalized }
    );
  return entry;
}
/**
 * Resolve an ID from a compatible prepared formula; unknown IDs throw FORMULA_COMPATIBILITY.
 * This fast lookup does not repeat the name-based policy gate. Do not use it to admit user input.
 */
export function getFunctionRegistryEntryById(
  id: number
): FunctionRegistryEntry {
  const e = byId.get(id);
  if (!e)
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `Unknown compiled function id ${id}.`
    );
  return e;
}

/**
 * Count all catalog entries by policy status and return registry identity metadata.
 * The total includes unavailable entries; it is not a count of numerically qualified functions.
 */
export function formulaJsRegistrySummary() {
  const counts = new Map<string, number>();
  for (const e of registryEntries)
    counts.set(e.status, (counts.get(e.status) ?? 0) + 1);
  return {
    formulaJsVersion: FORMULAJS_VERSION,
    fingerprint: FUNCTION_REGISTRY_FINGERPRINT,
    total: registryEntries.length,
    counts: Object.fromEntries(counts)
  };
}

/** Numeric operators are strict: BLANK is not silently coerced to zero. */
export function coerceNumber(v: DcmsValue): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
    return Number(v);
  throw new DcmsRuleError(
    "FORMULA_EXPECTED_NUMBER",
    `Expected a number, got ${render(v)}.`
  );
}
/** Boolean operators are strict: BLANK is not silently coerced to false. */
export function coerceBoolean(v: DcmsValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toUpperCase();
    if (s === "TRUE") return true;
    if (s === "FALSE") return false;
  }
  throw new DcmsRuleError(
    "FORMULA_EXPECTED_BOOLEAN",
    `Expected a Boolean value, got ${render(v)}.`
  );
}
/** String concatenation treats BLANK as an empty string. */
export function coerceString(v: DcmsValue): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(coerceString).join(",");
  return String(v);
}
function render(v: DcmsValue): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeResult(value: unknown, functionName?: string): DcmsValue {
  if (value instanceof Error) {
    const msg = value.message || String(value);
    if (/DIV\/0/i.test(msg))
      throw new DcmsRuleError(
        "FORMULA_DIV_ZERO",
        `${functionName ?? "Formula"}: division by zero.`,
        { functionName, cause: value }
      );
    if (/NUM/i.test(msg))
      throw new DcmsRuleError(
        "FORMULA_MATH_ERROR",
        `${functionName ?? "Formula"}: ${msg}`,
        { functionName, cause: value }
      );
    throw new DcmsRuleError(
      "FORMULA_BAD_ARGUMENTS",
      `${functionName ?? "Formula"}: ${msg}`,
      { functionName, cause: value }
    );
  }
  if (value instanceof Date)
    throw new DcmsRuleError(
      "FORMULA_DATE_TIME_UNSUPPORTED",
      `${functionName ?? "Formula"} returned a Date before DCMS date semantics are enabled.`,
      { functionName }
    );
  // Formula.js undefined is normalized to the DCMS BLANK representation.
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new DcmsRuleError(
        "FORMULA_INVALID_RESULT",
        `${functionName ?? "Formula"} produced a non-finite number.`
      );
    return value;
  }
  if (Array.isArray(value))
    return value.map((x) => normalizeResult(x, functionName));
  throw new DcmsRuleError(
    "FORMULA_INVALID_RESULT",
    `${functionName ?? "Formula"} returned an unsupported result type ${typeof value}.`
  );
}

function customEager(name: string, args: DcmsValue[]): DcmsValue {
  switch (name) {
    case "SUBSTITUTE":
      return substitute(args);
    case "CONTAINS":
      if (args.length !== 2)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "CONTAINS expects 2 arguments."
        );
      return coerceString(args[0]).includes(coerceString(args[1]));
    case "STARTSWITH":
      if (args.length !== 2)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "STARTSWITH expects 2 arguments."
        );
      return coerceString(args[0]).startsWith(coerceString(args[1]));
    case "ENDSWITH":
      if (args.length !== 2)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "ENDSWITH expects 2 arguments."
        );
      return coerceString(args[0]).endsWith(coerceString(args[1]));
    case "TO_NUMBER":
      if (args.length !== 1)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "TO_NUMBER expects 1 argument."
        );
      return coerceNumber(args[0]);
    case "TO_TEXT":
      if (args.length !== 1)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "TO_TEXT expects 1 argument."
        );
      return coerceString(args[0]);
    default:
      throw new DcmsRuleError(
        "FORMULA_COMPATIBILITY",
        `No eager DCMS implementation for ${name}.`,
        { functionName: name }
      );
  }
}

function cloneFormulaArgument(value: DcmsValue): DcmsValue {
  return Array.isArray(value) ? value.map(cloneFormulaArgument) : value;
}

/**
 * Invoke a trusted eager registry entry with already evaluated, validated arguments.
 * Apply expansion guards, detach arrays before upstream calls and normalize/check outputs.
 * Lazy entries are rejected; callers must not bypass registry policy with fabricated entries.
 */
export function callEagerFunction(
  entry: FunctionRegistryEntry,
  args: DcmsValue[]
): DcmsValue {
  if (entry.evaluationMode !== "eager")
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `${entry.name} requires lazy evaluation.`,
      { functionName: entry.name }
    );
  guardFunctionArguments(entry.name, args);
  if (entry.source === "dcms") {
    const result = customEager(entry.name, args);
    assertDcmsValue(result, "Function result", undefined, true);
    return result;
  }
  // Formula.js contains functions that sort or otherwise mutate array arguments internally.
  // DCMS evaluation is pure: third-party functions receive detached array values so one
  // validation/formula can never alter another row, field, or authoritative Record input.
  const isolatedArgs = args.map(cloneFormulaArgument);
  try {
    const raw = entry.implementation!(...isolatedArgs);
    const result = normalizeResult(raw, entry.name);
    assertDcmsValue(result, "Function result", undefined, true);
    return result;
  } catch (e) {
    if (e instanceof DcmsRuleError) throw e;
    throw new DcmsRuleError(
      "FORMULA_RUNTIME_ERROR",
      `${entry.name} failed: ${e instanceof Error ? e.message : String(e)}`,
      { functionName: entry.name, cause: e }
    );
  }
}

/** Helper used by the evaluator for the DCMS-specific FIELD() function during preparation. */
export function isFieldFunction(name: string): boolean {
  return name.toUpperCase() === "FIELD";
}

/** Kept here so the public registry contract can describe lazy functions without exposing evaluator internals. */
export type LazyEvaluator = (
  node: PreparedFormulaNode,
  ctx: FormulaEvaluationContext
) => DcmsValue;
