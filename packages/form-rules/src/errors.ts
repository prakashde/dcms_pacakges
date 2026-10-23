/**
 * Controlled error taxonomy shared across parsing, compilation, evaluation, compatibility, and resource limits.
 *
 * Why this exists: callers must distinguish ordinary validation failure from an engine/definition error. Stable codes
 * make that distinction portable across React, Express, logs, and acceptance tests.
 */
export type DcmsFormulaErrorCategory =
  | "lexical_error"
  | "syntax_error"
  | "unknown_function"
  | "unsupported_function"
  | "invalid_function_arguments"
  | "unresolved_reference"
  | "invalid_type_conversion"
  | "math_error"
  | "unsupported_date_time_semantics"
  | "evaluator_runtime_error"
  | "compatibility_error"
  | "definition_error"
  | "resource_limit_error";

export type DcmsRuleErrorCode =
  | "PAYLOAD_INVALID"
  | "FORMULA_EMPTY"
  | "FORMULA_LEXICAL_ERROR"
  | "FORMULA_SYNTAX_ERROR"
  | "FORMULA_INCOMPLETE"
  | "FORMULA_UNKNOWN_FUNCTION"
  | "FORMULA_UNSUPPORTED_FUNCTION"
  | "FORMULA_BAD_ARGUMENTS"
  | "FORMULA_UNRESOLVED_REFERENCE"
  | "FORMULA_EXPECTED_NUMBER"
  | "FORMULA_EXPECTED_BOOLEAN"
  | "FORMULA_INVALID_RESULT"
  | "FORMULA_DIV_ZERO"
  | "FORMULA_MATH_ERROR"
  | "FORMULA_DATE_TIME_UNSUPPORTED"
  | "FORMULA_RUNTIME_ERROR"
  | "FORMULA_COMPATIBILITY"
  | "FORMULA_CIRCULAR_REFERENCE"
  | "FORMULA_LIMIT_EXCEEDED"
  | "KEYWORD_EMPTY"
  | "KEYWORD_LEXICAL_ERROR"
  | "KEYWORD_SYNTAX_ERROR"
  | "KEYWORD_INCOMPLETE"
  | "KEYWORD_LIMIT_EXCEEDED"
  | "DEFINITION_DUPLICATE_FIELD"
  | "DEFINITION_DUPLICATE_ROW"
  | "DEFINITION_INVALID"
  | "DEFINITION_CYCLE"
  | "REVISION_DEFINITION_INVALID";

export interface DcmsRuleErrorOptions {
  category?: DcmsFormulaErrorCategory;
  position?: number;
  line?: number;
  column?: number;
  length?: number;
  functionName?: string;
  cause?: unknown;
}

/**
 * Controlled engine error with a stable code and optional source location/function context.
 * Catch by code rather than parsing messages. Formula offsets are zero-based; available
 * parser line/column values are one-based. A row error is distinct from a failed criterion.
 */
export class DcmsRuleError extends Error {
  readonly code: DcmsRuleErrorCode;
  readonly category: DcmsFormulaErrorCategory;
  readonly position?: number;
  readonly line?: number;
  readonly column?: number;
  readonly length?: number;
  readonly functionName?: string;
  readonly cause?: unknown;

  /** A numeric third argument is the legacy shorthand for a source offset. */
  constructor(
    code: DcmsRuleErrorCode,
    message: string,
    options: DcmsRuleErrorOptions | number = {}
  ) {
    super(message);
    this.name = "DcmsRuleError";
    this.code = code;
    const normalized =
      typeof options === "number" ? { position: options } : options;
    this.category = normalized.category ?? inferCategory(code);
    this.position = normalized.position;
    this.line = normalized.line;
    this.column = normalized.column;
    this.length = normalized.length;
    this.functionName = normalized.functionName;
    this.cause = normalized.cause;
  }
}

function inferCategory(code: DcmsRuleErrorCode): DcmsFormulaErrorCategory {
  if (code === "FORMULA_LIMIT_EXCEEDED" || code === "KEYWORD_LIMIT_EXCEEDED")
    return "resource_limit_error";
  if (code === "PAYLOAD_INVALID") return "invalid_type_conversion";
  if (code.includes("LEXICAL")) return "lexical_error";
  if (
    code.includes("SYNTAX") ||
    code.includes("INCOMPLETE") ||
    code.startsWith("KEYWORD_")
  )
    return "syntax_error";
  if (code === "FORMULA_UNKNOWN_FUNCTION") return "unknown_function";
  if (code === "FORMULA_UNSUPPORTED_FUNCTION") return "unsupported_function";
  if (code === "FORMULA_BAD_ARGUMENTS") return "invalid_function_arguments";
  if (code === "FORMULA_UNRESOLVED_REFERENCE") return "unresolved_reference";
  if (code === "FORMULA_EXPECTED_NUMBER" || code === "FORMULA_EXPECTED_BOOLEAN")
    return "invalid_type_conversion";
  if (
    code === "FORMULA_DIV_ZERO" ||
    code === "FORMULA_MATH_ERROR" ||
    code === "FORMULA_INVALID_RESULT"
  )
    return "math_error";
  if (code === "FORMULA_DATE_TIME_UNSUPPORTED")
    return "unsupported_date_time_semantics";
  if (code === "FORMULA_COMPATIBILITY") return "compatibility_error";
  if (
    code.startsWith("DEFINITION_") ||
    code.startsWith("REVISION_") ||
    code === "FORMULA_CIRCULAR_REFERENCE"
  )
    return "definition_error";
  return "evaluator_runtime_error";
}
