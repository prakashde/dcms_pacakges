/**
 * Prepared-formula compiler/evaluator boundary.
 *
 * Why this exists: formulas are parsed and resolved once, then repeatedly evaluated without eval()/Function() or
 * arbitrary JavaScript access. Runtime values are isolated before third-party Formula.js calls so formula execution
 * cannot mutate authoritative Record inputs or leak state between validation rows.
 */
import type {
  DcmsValue,
  FormulaEvaluationContext,
  FormulaNode,
  PreparedFormula,
  PreparedFormulaNode
} from "./types.js";
import { assertDcmsValue, valueBudget } from "./boundaries.js";
import { DcmsRuleError } from "./errors.js";
import {
  FORMULA_COMPILER_VERSION,
  FORMULA_LANGUAGE_VERSION,
  FORMULA_REGISTRY_VERSION,
  FORMULAJS_VERSION,
  FUNCTION_REGISTRY_FINGERPRINT,
  callEagerFunction,
  coerceBoolean,
  coerceNumber,
  coerceString,
  getFunctionRegistryEntry,
  getFunctionRegistryEntryById,
  isFieldFunction
} from "./functions.js";
import { parseFormula } from "./formula-parser.js";
import { DCMS_RULE_LIMITS_VERSION, FORMULA_LIMITS } from "./limits.js";
import { compatibilityHash64 } from "./compatibility.js";

/**
 * Accumulate reference IDs into out and return that same Set. VALUE is excluded;
 * FIELD with a literal string contributes that ID. This traversal is not AST validation.
 */
export function collectFormulaDependencies(
  node: FormulaNode,
  out = new Set<string>()
): Set<string> {
  switch (node.kind) {
    case "reference":
      if (node.name.toUpperCase() !== "VALUE") out.add(node.name);
      break;
    case "unary":
      collectFormulaDependencies(node.value, out);
      break;
    case "binary":
      collectFormulaDependencies(node.left, out);
      collectFormulaDependencies(node.right, out);
      break;
    case "call":
      if (isFieldFunction(node.name)) {
        const a = node.args[0];
        if (a?.kind === "literal" && typeof a.value === "string")
          out.add(a.value);
      } else node.args.forEach((x) => collectFormulaDependencies(x, out));
      break;
  }
  return out;
}

function prepareNode(
  node: FormulaNode,
  refs: Set<string>,
  functions: Set<number>,
  count: { n: number },
  depth = 1
): PreparedFormulaNode {
  count.n++;
  if (count.n > FORMULA_LIMITS.maxAstNodes)
    throw new DcmsRuleError(
      "FORMULA_LIMIT_EXCEEDED",
      `Formula exceeds the maximum prepared node count of ${FORMULA_LIMITS.maxAstNodes}.`,
      { position: node.span?.startOffset }
    );
  if (depth > FORMULA_LIMITS.maxAstDepth)
    throw new DcmsRuleError(
      "FORMULA_LIMIT_EXCEEDED",
      `Formula exceeds the maximum expression depth of ${FORMULA_LIMITS.maxAstDepth}.`,
      { position: node.span?.startOffset }
    );
  switch (node.kind) {
    case "literal":
      return { ...node };
    case "reference": {
      if (node.name.toUpperCase() === "VALUE")
        return { kind: "value", span: node.span };
      refs.add(node.name);
      return { kind: "reference", name: node.name, span: node.span };
    }
    case "unary":
      return {
        kind: "unary",
        op: node.op,
        value: prepareNode(node.value, refs, functions, count, depth + 1),
        span: node.span
      };
    case "binary":
      return {
        kind: "binary",
        op: node.op,
        left: prepareNode(node.left, refs, functions, count, depth + 1),
        right: prepareNode(node.right, refs, functions, count, depth + 1),
        span: node.span
      };
    case "call": {
      if (node.args.length > FORMULA_LIMITS.maxFunctionArguments)
        throw new DcmsRuleError(
          "FORMULA_LIMIT_EXCEEDED",
          `Function ${node.name} exceeds the maximum of ${FORMULA_LIMITS.maxFunctionArguments} arguments.`,
          {
            functionName: node.name.toUpperCase(),
            position: node.span?.startOffset
          }
        );
      const name = node.name.toUpperCase();
      if (isFieldFunction(name)) {
        if (
          node.args.length !== 1 ||
          node.args[0].kind !== "literal" ||
          typeof node.args[0].value !== "string"
        )
          throw new DcmsRuleError(
            "FORMULA_BAD_ARGUMENTS",
            "FIELD requires exactly one string field/reference ID.",
            { functionName: "FIELD", position: node.span?.startOffset }
          );
        refs.add(node.args[0].value);
        return { kind: "reference", name: node.args[0].value, span: node.span };
      }
      const entry = getFunctionRegistryEntry(name);
      functions.add(entry.id);
      return {
        kind: "call",
        name: entry.name,
        functionId: entry.id,
        args: node.args.map((x) =>
          prepareNode(x, refs, functions, count, depth + 1)
        ),
        span: node.span
      };
    }
  }
}

/**
 * Prepare a trusted parser AST, resolving function policy and enforcing preparation limits.
 * source is identity/diagnostic text: it is not reparsed or compared with the supplied AST.
 * For untrusted authoring input use prepareFormula(source). Keep the prepared result private.
 */
export function prepareFormulaAst(
  ast: FormulaNode,
  source = "=<prepared-ast>"
): PreparedFormula {
  const refs = new Set<string>(),
    functions = new Set<number>(),
    count = { n: 0 };
  const root = prepareNode(ast, refs, functions, count);
  if (refs.size > FORMULA_LIMITS.maxReferences)
    throw new DcmsRuleError(
      "FORMULA_LIMIT_EXCEEDED",
      `Formula exceeds the maximum of ${FORMULA_LIMITS.maxReferences} unique references.`
    );
  return {
    source,
    ast,
    root,
    references: [...refs],
    functionIds: [...functions],
    registryFingerprint: FUNCTION_REGISTRY_FINGERPRINT,
    registryVersion: FORMULA_REGISTRY_VERSION,
    formulaJsVersion: FORMULAJS_VERSION,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    compilerVersion: FORMULA_COMPILER_VERSION,
    limitsVersion: DCMS_RULE_LIMITS_VERSION,
    sourceHash: compatibilityHash64(source),
    nodeCount: count.n
  };
}

/**
 * Parse source text and prepare reusable execution nodes; syntax, policy and size failures throw DcmsRuleError.
 */
export function prepareFormula(source: string): PreparedFormula {
  return prepareFormulaAst(parseFormula(source), source);
}

function getReference(ctx: FormulaEvaluationContext, name: string): DcmsValue {
  if (ctx.references.has(name)) {
    const value = ctx.references.get(name)!;
    assertDcmsValue(value, `Reference ${name}`);
    return value;
  }
  throw new DcmsRuleError(
    "FORMULA_UNRESOLVED_REFERENCE",
    `Unresolved DCMS reference ${name}.`,
    { position: undefined }
  );
}
function compare(a: DcmsValue, b: DcmsValue): number {
  if (typeof a === "number" && typeof b === "number")
    return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "string" && typeof b === "string")
    return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean")
    return a === b ? 0 : a ? 1 : -1;
  if (a === null && b === null) return 0;
  // Numeric text may compare numerically with a numeric value; other mixed types are not silently ordered.
  try {
    const na = coerceNumber(a),
      nb = coerceNumber(b);
    return na === nb ? 0 : na < nb ? -1 : 1;
  } catch {}
  throw new DcmsRuleError(
    "FORMULA_BAD_ARGUMENTS",
    `Cannot compare ${coerceString(a)} with ${coerceString(b)}.`
  );
}
function equals(a: DcmsValue, b: DcmsValue): boolean {
  if (Array.isArray(a) || Array.isArray(b))
    return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === typeof b) return a === b;
  try {
    return coerceNumber(a) === coerceNumber(b);
  } catch {
    return false;
  }
}

function finiteArithmeticResult(
  value: number,
  operation: string,
  position?: number
): number {
  if (!Number.isFinite(value))
    throw new DcmsRuleError(
      "FORMULA_MATH_ERROR",
      `${operation} produced a non-finite result.`,
      { position }
    );
  return value;
}

// Keep branch selection here: eagerly mapping all arguments would evaluate unused errors/references.
function evalLazy(
  name: string,
  args: PreparedFormulaNode[],
  ctx: FormulaEvaluationContext
): DcmsValue {
  const ev = (x: PreparedFormulaNode) => evaluatePreparedNode(x, ctx);
  switch (name) {
    case "IF": {
      if (args.length < 2 || args.length > 3)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "IF expects 2 or 3 arguments.",
          { functionName: name }
        );
      return coerceBoolean(ev(args[0]))
        ? ev(args[1])
        : args[2]
          ? ev(args[2])
          : false;
    }
    case "IFS": {
      if (args.length < 2 || args.length % 2 !== 0)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "IFS expects condition/value pairs.",
          { functionName: name }
        );
      for (let i = 0; i < args.length; i += 2)
        if (coerceBoolean(ev(args[i]))) return ev(args[i + 1]);
      throw new DcmsRuleError(
        "FORMULA_RUNTIME_ERROR",
        "IFS found no true condition.",
        { functionName: name }
      );
    }
    case "SWITCH": {
      if (args.length < 3)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "SWITCH expects an expression plus match/result pairs and optional default.",
          { functionName: name }
        );
      const target = ev(args[0]);
      const remaining = args.length - 1,
        hasDefault = remaining % 2 === 1,
        pairEnd = hasDefault ? args.length - 1 : args.length;
      for (let i = 1; i < pairEnd; i += 2)
        if (equals(target, ev(args[i]))) return ev(args[i + 1]);
      if (hasDefault) return ev(args[args.length - 1]);
      throw new DcmsRuleError(
        "FORMULA_RUNTIME_ERROR",
        "SWITCH found no matching value and no default.",
        { functionName: name }
      );
    }
    case "CHOOSE": {
      if (args.length < 2)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "CHOOSE expects an index and at least one value.",
          { functionName: name }
        );
      const idx = coerceNumber(ev(args[0]));
      if (!Number.isInteger(idx) || idx < 1 || idx >= args.length)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "CHOOSE index is out of range.",
          { functionName: name }
        );
      return ev(args[idx]);
    }
    case "AND": {
      if (!args.length)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "AND expects at least one argument.",
          { functionName: name }
        );
      for (const a of args) if (!coerceBoolean(ev(a))) return false;
      return true;
    }
    case "OR": {
      if (!args.length)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "OR expects at least one argument.",
          { functionName: name }
        );
      for (const a of args) if (coerceBoolean(ev(a))) return true;
      return false;
    }
    case "NOT":
      if (args.length !== 1)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "NOT expects 1 argument.",
          { functionName: name }
        );
      else return !coerceBoolean(ev(args[0]));
    case "COALESCE": {
      if (!args.length)
        throw new DcmsRuleError(
          "FORMULA_BAD_ARGUMENTS",
          "COALESCE expects at least one argument.",
          { functionName: name }
        );
      for (const a of args) {
        const v = ev(a);
        if (v !== null && v !== "") return v;
      }
      return null;
    }
    default:
      throw new DcmsRuleError(
        "FORMULA_COMPATIBILITY",
        `No lazy DCMS implementation for ${name}.`,
        { functionName: name }
      );
  }
}

/**
 * Low-level recursive dispatcher for nodes produced by this engine. Preserves lazy branches.
 * It does not check whole-plan compatibility; consumers should use evaluatePreparedFormula
 * or evaluateRecord rather than passing arbitrary node objects here.
 */
export function evaluatePreparedNode(
  node: PreparedFormulaNode,
  ctx: FormulaEvaluationContext
): DcmsValue {
  try {
    return evaluateNode(node, ctx);
  } catch (e) {
    if (e instanceof DcmsRuleError && e.position === undefined && node.span)
      throw new DcmsRuleError(e.code, e.message, {
        category: e.category,
        position: node.span.startOffset,
        length: node.span.endOffset - node.span.startOffset + 1,
        functionName: e.functionName,
        cause: e
      });
    throw e;
  }
}
function evaluateNode(
  node: PreparedFormulaNode,
  ctx: FormulaEvaluationContext
): DcmsValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "value":
      return ctx.value;
    case "reference":
      return getReference(ctx, node.name);
    case "unary": {
      if (node.op === "NOT")
        return !coerceBoolean(evaluatePreparedNode(node.value, ctx));
      const n = coerceNumber(evaluatePreparedNode(node.value, ctx));
      return finiteArithmeticResult(
        node.op === "-" ? -n : n,
        `Unary ${node.op}`,
        node.span?.startOffset
      );
    }
    case "binary": {
      if (node.op === "AND") {
        const l = coerceBoolean(evaluatePreparedNode(node.left, ctx));
        return l ? coerceBoolean(evaluatePreparedNode(node.right, ctx)) : false;
      }
      if (node.op === "OR") {
        const l = coerceBoolean(evaluatePreparedNode(node.left, ctx));
        return l ? true : coerceBoolean(evaluatePreparedNode(node.right, ctx));
      }
      const l = evaluatePreparedNode(node.left, ctx),
        r = evaluatePreparedNode(node.right, ctx);
      switch (node.op) {
        case "+":
          return finiteArithmeticResult(
            coerceNumber(l) + coerceNumber(r),
            "Addition",
            node.span?.startOffset
          );
        case "-":
          return finiteArithmeticResult(
            coerceNumber(l) - coerceNumber(r),
            "Subtraction",
            node.span?.startOffset
          );
        case "*":
          return finiteArithmeticResult(
            coerceNumber(l) * coerceNumber(r),
            "Multiplication",
            node.span?.startOffset
          );
        case "/": {
          const d = coerceNumber(r);
          if (d === 0)
            throw new DcmsRuleError("FORMULA_DIV_ZERO", "Division by zero.", {
              position: node.span?.startOffset
            });
          return finiteArithmeticResult(
            coerceNumber(l) / d,
            "Division",
            node.span?.startOffset
          );
        }
        case "^":
          return finiteArithmeticResult(
            Math.pow(coerceNumber(l), coerceNumber(r)),
            "Power operation",
            node.span?.startOffset
          );
        case "&": {
          const text = coerceString(l) + coerceString(r);
          assertDcmsValue(text, "Concatenation", undefined, true);
          return text;
        }
        case "=":
          return equals(l, r);
        case "<>":
          return !equals(l, r);
        case "<":
          return compare(l, r) < 0;
        case "<=":
          return compare(l, r) <= 0;
        case ">":
          return compare(l, r) > 0;
        case ">=":
          return compare(l, r) >= 0;
      }
      throw new DcmsRuleError(
        "FORMULA_RUNTIME_ERROR",
        `Unknown operator ${(node as any).op}.`
      );
    }
    case "call": {
      const entry = getFunctionRegistryEntryById(node.functionId);
      if (entry.evaluationMode === "lazy")
        return evalLazy(entry.name, node.args, ctx);
      return callEagerFunction(
        entry,
        node.args.map((x) => evaluatePreparedNode(x, ctx))
      );
    }
  }
}

const preparedCompatibilityCache = new WeakMap<
  object,
  { source: string; identity: string }
>();
function preparedCompatibilityIdentity(prepared: PreparedFormula): string {
  return [
    prepared.registryFingerprint,
    prepared.registryVersion,
    prepared.formulaJsVersion,
    prepared.languageVersion,
    prepared.compilerVersion,
    prepared.limitsVersion,
    prepared.sourceHash
  ].join("|");
}
function assertPreparedFormulaCompatible(prepared: PreparedFormula): void {
  const identity = preparedCompatibilityIdentity(prepared);
  const cached = preparedCompatibilityCache.get(prepared as object);
  if (cached?.source === prepared.source && cached.identity === identity)
    return;
  const mismatches: string[] = [];
  if (prepared.registryFingerprint !== FUNCTION_REGISTRY_FINGERPRINT)
    mismatches.push("registry fingerprint");
  if (prepared.registryVersion !== FORMULA_REGISTRY_VERSION)
    mismatches.push("registry version");
  if (prepared.formulaJsVersion !== FORMULAJS_VERSION)
    mismatches.push("Formula.js version");
  if (prepared.languageVersion !== FORMULA_LANGUAGE_VERSION)
    mismatches.push("formula language version");
  if (prepared.compilerVersion !== FORMULA_COMPILER_VERSION)
    mismatches.push("compiler version");
  if (prepared.limitsVersion !== DCMS_RULE_LIMITS_VERSION)
    mismatches.push("limits version");
  if (prepared.sourceHash !== compatibilityHash64(prepared.source))
    mismatches.push("formula source hash");
  if (mismatches.length)
    throw new DcmsRuleError(
      "FORMULA_COMPATIBILITY",
      `Prepared formula is incompatible with this engine: ${mismatches.join(", ")}.`
    );
  preparedCompatibilityCache.set(prepared as object, {
    source: prepared.source,
    identity
  });
}

/**
 * Check prepared identity, validate VALUE, evaluate and validate the result.
 * References are checked when read; an unused lazy branch is not evaluated. Controlled
 * errors propagate to the caller. This synchronous API cannot enforce a wall-clock deadline.
 */
export function evaluatePreparedFormula(
  prepared: PreparedFormula,
  ctx: FormulaEvaluationContext
): DcmsValue {
  assertPreparedFormulaCompatible(prepared);
  const budget = valueBudget();
  assertDcmsValue(ctx.value, "VALUE", budget);
  const result = evaluatePreparedNode(prepared.root, ctx);
  assertDcmsValue(result, "Formula result", undefined, true);
  return result;
}

/** Convenience API for design-time or one-off evaluation. Normal record entry should prepare once and reuse. */
export function evaluateFormula(
  astOrSource: FormulaNode | string,
  ctx: {
    value: DcmsValue;
    references?: ReadonlyMap<string, DcmsValue>;
    fields?: ReadonlyMap<string, DcmsValue>;
  }
): DcmsValue {
  const refs = ctx.references ?? ctx.fields ?? new Map<string, DcmsValue>();
  if (typeof astOrSource === "string")
    return evaluatePreparedFormula(prepareFormula(astOrSource), {
      value: ctx.value,
      references: refs
    });
  return evaluatePreparedFormula(prepareFormulaAst(astOrSource), {
    value: ctx.value,
    references: refs
  });
}
