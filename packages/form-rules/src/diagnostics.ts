/**
 * Authoring diagnostics for incomplete versus invalid formula/keyword input.
 *
 * Why this exists: editors need helpful feedback while a user is still typing without weakening the compiler's final
 * definition checks. Diagnostics are advisory; compile-time validation remains the authority.
 */
import { parseFormula } from "./formula-parser.js";
import { parseKeywordExpressionDetailed } from "./keyword-parser.js";
import type { KeywordParseWarning } from "./types.js";

export type DiagnosticState = "valid" | "incomplete" | "invalid";
export interface ParseDiagnostic {
  state: DiagnosticState;
  message?: string;
  warnings?: KeywordParseWarning[];
}

function classifyFormulaMessage(message: string): DiagnosticState {
  const m = message.toLowerCase();
  if (
    m.includes("unclosed") ||
    m.includes("expected ')'") ||
    m.includes("expecting token of type --> rparen") ||
    m.includes("but found --> ''") ||
    m.includes("after")
  )
    return "incomplete";
  return "invalid";
}

/**
 * Offer syntax feedback while typing; incomplete classification uses parser-message heuristics.
 * A valid result does not establish function support or definition validity. Compile before use.
 */
export function diagnoseFormula(source: string): ParseDiagnostic {
  if (!source.trim() || source.trim() === "=")
    return { state: "incomplete", message: "Expression is empty." };
  try {
    parseFormula(source);
    return { state: "valid" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { state: classifyFormulaMessage(message), message };
  }
}

function uniqueWarnings(
  warnings: KeywordParseWarning[]
): KeywordParseWarning[] {
  const seen = new Set<string>();
  const out: KeywordParseWarning[] = [];
  for (const w of warnings) {
    if (!seen.has(w.code)) {
      seen.add(w.code);
      out.push(w);
    }
  }
  return out;
}

/**
 * Offer keyword syntax feedback and deduplicated implicit-OR/operator-case warnings.
 * An empty keyword is invalid; a trailing operator is incomplete. Final compilation is authoritative.
 */
export function diagnoseKeywordExpression(source: string): ParseDiagnostic {
  const trimmed = source.trim();
  if (!trimmed) return { state: "invalid", message: "Keyword is required." };
  if (/^(AND|OR)\b/.test(trimmed))
    return {
      state: "invalid",
      message: "Expression cannot start with AND or OR."
    };
  if (/\b(AND|OR|NOT)\s*$/.test(trimmed))
    return {
      state: "incomplete",
      message: "Expression ends with an operator; add a keyword."
    };
  try {
    const result = parseKeywordExpressionDetailed(source);
    return { state: "valid", warnings: uniqueWarnings(result.warnings) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const state: DiagnosticState = /unclosed|expected '\)'/i.test(message)
      ? "incomplete"
      : "invalid";
    return { state, message };
  }
}
