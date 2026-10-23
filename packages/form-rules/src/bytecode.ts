/**
 * Compatibility facade for the historical compile/evaluate program API.
 *
 * Why it stays small: current benchmarks do not justify a custom VM. Preserving the facade lets callers remain stable
 * while leaving room for a future flat execution backend only if measured production workloads require it.
 */
// Compatibility facade. v0.8 retains the compile/evaluate API while using a prepared AST.
// A custom bytecode VM may be added later only if browser/Express benchmarks justify it.
import type { FormulaNode, PreparedFormula, DcmsValue } from "./types.js";
import {
  evaluatePreparedFormula,
  prepareFormula,
  prepareFormulaAst
} from "./formula-evaluator.js";

export interface FormulaProgramContext {
  value: DcmsValue;
  fields?: ReadonlyMap<string, DcmsValue>;
  references?: ReadonlyMap<string, DcmsValue>;
}
/**
 * Prepare a formula through the historical program API. The result is a prepared AST,
 * not bytecode. Prefer source text; supplied ASTs must come from trusted parser code.
 */
export function compileFormulaProgram(
  astOrSource: FormulaNode | string
): PreparedFormula {
  return typeof astOrSource === "string"
    ? prepareFormula(astOrSource)
    : prepareFormulaAst(astOrSource);
}
/**
 * Evaluate a compatible prepared program. references takes precedence over the legacy
 * fields alias, including when references is an empty Map. Throws controlled formula errors.
 */
export function evaluateFormulaProgram(
  program: PreparedFormula,
  ctx: FormulaProgramContext
): DcmsValue {
  return evaluatePreparedFormula(program, {
    value: ctx.value,
    references: ctx.references ?? ctx.fields ?? new Map()
  });
}
