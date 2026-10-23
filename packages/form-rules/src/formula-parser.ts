/**
 * Chevrotain grammar for the controlled DCMS formula language.
 *
 * Why this exists: DCMS owns syntax and compatibility even though Formula.js supplies many function implementations.
 * A generic function-call grammar avoids hard-coding one parser production per Formula.js function.
 */
import {
  createToken,
  EmbeddedActionsParser,
  Lexer,
  tokenMatcher,
  type IToken,
  type TokenType
} from "chevrotain";
import type { FormulaNode, SourceSpan } from "./types.js";
import { DcmsRuleError } from "./errors.js";
import { FORMULA_LIMITS } from "./limits.js";

const FunctionName = createToken({ name: "FunctionName", pattern: Lexer.NA });
const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED
});
const Identifier = createToken({
  name: "Identifier",
  pattern: /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/,
  categories: [FunctionName]
});
const And = createToken({
  name: "And",
  pattern: /AND\b/i,
  longer_alt: Identifier,
  categories: [FunctionName]
});
const Or = createToken({
  name: "Or",
  pattern: /OR\b/i,
  longer_alt: Identifier,
  categories: [FunctionName]
});
const Not = createToken({
  name: "Not",
  pattern: /NOT\b/i,
  longer_alt: Identifier
});
const True = createToken({
  name: "True",
  pattern: /TRUE\b/i,
  longer_alt: Identifier,
  categories: [FunctionName]
});
const False = createToken({
  name: "False",
  pattern: /FALSE\b/i,
  longer_alt: Identifier,
  categories: [FunctionName]
});
const NumberLiteral = createToken({
  name: "NumberLiteral",
  pattern: /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
});
const StringLiteral = createToken({
  name: "StringLiteral",
  pattern: /"(?:""|[^"])*"/,
  line_breaks: true
});
const LessEqual = createToken({ name: "LessEqual", pattern: /<=/ });
const GreaterEqual = createToken({ name: "GreaterEqual", pattern: />=/ });
const NotEqualExcel = createToken({ name: "NotEqualExcel", pattern: /<>/ });
const NotEqualBang = createToken({ name: "NotEqualBang", pattern: /!=/ });
const Equal = createToken({ name: "Equal", pattern: /=/ });
const Less = createToken({ name: "Less", pattern: /</ });
const Greater = createToken({ name: "Greater", pattern: />/ });
const Power = createToken({ name: "Power", pattern: /\^/ });
const Amp = createToken({ name: "Amp", pattern: /&/ });
const Plus = createToken({ name: "Plus", pattern: /\+/ });
const Minus = createToken({ name: "Minus", pattern: /-/ });
const Multiply = createToken({ name: "Multiply", pattern: /\*/ });
const Divide = createToken({ name: "Divide", pattern: /\// });
const LParen = createToken({ name: "LParen", pattern: /\(/ });
const RParen = createToken({ name: "RParen", pattern: /\)/ });
const Comma = createToken({ name: "Comma", pattern: /,/ });

const allTokens: TokenType[] = [
  WhiteSpace,
  And,
  Or,
  Not,
  True,
  False,
  NumberLiteral,
  StringLiteral,
  LessEqual,
  GreaterEqual,
  NotEqualExcel,
  NotEqualBang,
  Equal,
  Less,
  Greater,
  Power,
  Amp,
  Plus,
  Minus,
  Multiply,
  Divide,
  LParen,
  RParen,
  Comma,
  Identifier,
  FunctionName
];
const formulaLexer = new Lexer(allTokens, { positionTracking: "full" });

function spanFromToken(t: IToken): SourceSpan {
  return {
    startOffset: t.startOffset ?? 0,
    endOffset: t.endOffset ?? t.startOffset ?? 0,
    startLine: t.startLine,
    startColumn: t.startColumn,
    endLine: t.endLine,
    endColumn: t.endColumn
  };
}
function mergeSpan(a?: SourceSpan, b?: SourceSpan): SourceSpan | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    startOffset: Math.min(a.startOffset, b.startOffset),
    endOffset: Math.max(a.endOffset, b.endOffset),
    startLine: a.startLine,
    startColumn: a.startColumn,
    endLine: b.endLine,
    endColumn: b.endColumn
  };
}
function unquoteExcelString(image: string): string {
  return image.slice(1, -1).replace(/""/g, '"');
}

class DcmsFormulaParser extends EmbeddedActionsParser {
  expression!: () => FormulaNode;
  orExpression!: () => FormulaNode;
  andExpression!: () => FormulaNode;
  notExpression!: () => FormulaNode;
  comparisonExpression!: () => FormulaNode;
  concatExpression!: () => FormulaNode;
  additiveExpression!: () => FormulaNode;
  multiplicativeExpression!: () => FormulaNode;
  unaryArithmeticExpression!: () => FormulaNode;
  powerExpression!: () => FormulaNode;
  primaryExpression!: () => FormulaNode;
  nameOrFunction!: () => FormulaNode;

  constructor() {
    super(allTokens, { maxLookahead: 4, recoveryEnabled: false });
    const $ = this;

    $.expression = $.RULE(
      "expression",
      () => $.SUBRULE($.orExpression) as FormulaNode
    );

    $.orExpression = $.RULE("orExpression", () => {
      let left = $.SUBRULE($.andExpression) as FormulaNode;
      $.MANY(() => {
        $.CONSUME(Or);
        const right = $.SUBRULE2($.andExpression) as FormulaNode;
        left = {
          kind: "binary",
          op: "OR",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return left;
    });

    $.andExpression = $.RULE("andExpression", () => {
      let left = $.SUBRULE($.notExpression) as FormulaNode;
      $.MANY(() => {
        $.CONSUME(And);
        const right = $.SUBRULE2($.notExpression) as FormulaNode;
        left = {
          kind: "binary",
          op: "AND",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return left;
    });

    $.notExpression = $.RULE(
      "notExpression",
      () =>
        $.OR([
          {
            ALT: () => {
              const t = $.CONSUME(Not);
              const value = $.SUBRULE($.notExpression) as FormulaNode;
              return {
                kind: "unary",
                op: "NOT",
                value,
                span: mergeSpan(spanFromToken(t), value.span)
              } as FormulaNode;
            }
          },
          { ALT: () => $.SUBRULE($.comparisonExpression) as FormulaNode }
        ]) as FormulaNode
    );

    $.comparisonExpression = $.RULE("comparisonExpression", () => {
      let left = $.SUBRULE($.concatExpression) as FormulaNode;
      $.OPTION(() => {
        const op = $.OR([
          { ALT: () => $.CONSUME(LessEqual) },
          { ALT: () => $.CONSUME(GreaterEqual) },
          { ALT: () => $.CONSUME(NotEqualExcel) },
          { ALT: () => $.CONSUME(NotEqualBang) },
          { ALT: () => $.CONSUME(Equal) },
          { ALT: () => $.CONSUME(Less) },
          { ALT: () => $.CONSUME(Greater) }
        ]);
        const right = $.SUBRULE2($.concatExpression) as FormulaNode;
        const normalized = op.image === "!=" ? "<>" : op.image;
        left = {
          kind: "binary",
          op: normalized as "=" | "<>" | "<" | "<=" | ">" | ">=",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return left;
    });

    $.concatExpression = $.RULE("concatExpression", () => {
      let left = $.SUBRULE($.additiveExpression) as FormulaNode;
      $.MANY(() => {
        $.CONSUME(Amp);
        const right = $.SUBRULE2($.additiveExpression) as FormulaNode;
        left = {
          kind: "binary",
          op: "&",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return left;
    });

    $.additiveExpression = $.RULE("additiveExpression", () => {
      let left = $.SUBRULE($.multiplicativeExpression) as FormulaNode;
      $.MANY(() => {
        const op = $.OR([
          { ALT: () => $.CONSUME(Plus) },
          { ALT: () => $.CONSUME(Minus) }
        ]);
        const right = $.SUBRULE2($.multiplicativeExpression) as FormulaNode;
        left = {
          kind: "binary",
          op: op.image as "+" | "-",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return left;
    });

    $.multiplicativeExpression = $.RULE("multiplicativeExpression", () => {
      let left = $.SUBRULE($.unaryArithmeticExpression) as FormulaNode;
      $.MANY(() => {
        const op = $.OR([
          { ALT: () => $.CONSUME(Multiply) },
          { ALT: () => $.CONSUME(Divide) }
        ]);
        const right = $.SUBRULE2($.unaryArithmeticExpression) as FormulaNode;
        left = {
          kind: "binary",
          op: op.image as "*" | "/",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return left;
    });

    $.unaryArithmeticExpression = $.RULE(
      "unaryArithmeticExpression",
      () =>
        $.OR([
          {
            ALT: () => {
              const op = $.OR1([
                { ALT: () => $.CONSUME(Plus) },
                { ALT: () => $.CONSUME(Minus) }
              ]);
              const value = $.SUBRULE(
                $.unaryArithmeticExpression
              ) as FormulaNode;
              return {
                kind: "unary",
                op: op.image as "+" | "-",
                value,
                span: mergeSpan(spanFromToken(op), value.span)
              } as FormulaNode;
            }
          },
          { ALT: () => $.SUBRULE($.powerExpression) as FormulaNode }
        ]) as FormulaNode
    );

    $.powerExpression = $.RULE("powerExpression", () => {
      const left = $.SUBRULE($.primaryExpression) as FormulaNode;
      let result = left;
      $.OPTION(() => {
        $.CONSUME(Power);
        const right = $.SUBRULE($.unaryArithmeticExpression) as FormulaNode;
        result = {
          kind: "binary",
          op: "^",
          left,
          right,
          span: mergeSpan(left.span, right.span)
        };
      });
      return result;
    });

    $.primaryExpression = $.RULE(
      "primaryExpression",
      () =>
        $.OR([
          {
            ALT: () => {
              const t = $.CONSUME(NumberLiteral);
              return {
                kind: "literal",
                value: Number(t.image),
                span: spanFromToken(t)
              } as FormulaNode;
            }
          },
          {
            ALT: () => {
              const t = $.CONSUME(StringLiteral);
              return {
                kind: "literal",
                value: unquoteExcelString(t.image),
                span: spanFromToken(t)
              } as FormulaNode;
            }
          },
          {
            ALT: () => {
              const l = $.CONSUME(LParen);
              const n = $.SUBRULE($.expression) as FormulaNode;
              const r = $.CONSUME(RParen);
              return {
                ...n,
                span: mergeSpan(spanFromToken(l), spanFromToken(r))
              } as FormulaNode;
            }
          },
          { ALT: () => $.SUBRULE($.nameOrFunction) as FormulaNode }
        ]) as FormulaNode
    );

    $.nameOrFunction = $.RULE(
      "nameOrFunction",
      () =>
        $.OR([
          {
            ALT: () => {
              const nameTok = $.CONSUME(FunctionName);
              const name = nameTok.image.toUpperCase();
              $.CONSUME(LParen);
              const args: FormulaNode[] = [];
              $.OPTION(() => {
                args.push($.SUBRULE($.expression) as FormulaNode);
                $.MANY(() => {
                  $.CONSUME(Comma);
                  args.push($.SUBRULE2($.expression) as FormulaNode);
                });
              });
              const close = $.CONSUME(RParen);
              return {
                kind: "call",
                name,
                args,
                span: mergeSpan(spanFromToken(nameTok), spanFromToken(close))
              } as FormulaNode;
            }
          },
          {
            ALT: () => {
              const t = $.CONSUME(True);
              return {
                kind: "literal",
                value: true,
                span: spanFromToken(t)
              } as FormulaNode;
            }
          },
          {
            ALT: () => {
              const t = $.CONSUME(False);
              return {
                kind: "literal",
                value: false,
                span: spanFromToken(t)
              } as FormulaNode;
            }
          },
          {
            ALT: () => {
              const t = $.CONSUME(Identifier);
              return {
                kind: "reference",
                name: t.image,
                span: spanFromToken(t)
              } as FormulaNode;
            }
          }
        ]) as FormulaNode
    );

    this.performSelfAnalysis();
  }
}

const parser = new DcmsFormulaParser();

function stripFormulaMarker(source: string): { text: string; base: number } {
  const m = source.match(/^\s*=/);
  if (!m) return { text: source, base: 0 };
  return { text: source.slice(m[0].length), base: m[0].length };
}
function shiftSpan(node: FormulaNode, base: number): FormulaNode {
  if (!base) return node;
  const s = node.span
    ? {
        ...node.span,
        startOffset: node.span.startOffset + base,
        endOffset: node.span.endOffset + base
      }
    : undefined;
  switch (node.kind) {
    case "literal":
      return { ...node, span: s };
    case "reference":
      return { ...node, span: s };
    case "unary":
      return { ...node, span: s, value: shiftSpan(node.value, base) };
    case "binary":
      return {
        ...node,
        span: s,
        left: shiftSpan(node.left, base),
        right: shiftSpan(node.right, base)
      };
    case "call":
      return {
        ...node,
        span: s,
        args: node.args.map((x) => shiftSpan(x, base))
      };
  }
}

/**
 * Parse formula text into an AST with spans in the original source, including a leading '='.
 * Enforce parser size/depth limits and finite literals; do not execute JavaScript or resolve
 * function availability. Use prepareFormula to apply registry policy before evaluation.
 */
export function parseFormula(source: string): FormulaNode {
  if (typeof source !== "string")
    throw new DcmsRuleError(
      "FORMULA_SYNTAX_ERROR",
      "Formula source must be a string."
    );
  if (source.length > FORMULA_LIMITS.maxSourceLength)
    throw new DcmsRuleError(
      "FORMULA_LIMIT_EXCEEDED",
      `Formula exceeds the maximum length of ${FORMULA_LIMITS.maxSourceLength} characters.`,
      { position: FORMULA_LIMITS.maxSourceLength }
    );
  const stripped = stripFormulaMarker(source);
  if (!stripped.text.trim())
    throw new DcmsRuleError("FORMULA_EMPTY", "Expression is empty.", 0);
  const lex = formulaLexer.tokenize(stripped.text);
  if (lex.errors.length) {
    const e = lex.errors[0];
    throw new DcmsRuleError("FORMULA_LEXICAL_ERROR", e.message, {
      position: stripped.base + e.offset,
      line: e.line,
      column: e.column,
      length: e.length
    });
  }
  let parenDepth = 0;
  for (const t of lex.tokens) {
    if (tokenMatcher(t, LParen)) {
      parenDepth++;
      if (parenDepth > FORMULA_LIMITS.maxParenthesisDepth)
        throw new DcmsRuleError(
          "FORMULA_LIMIT_EXCEEDED",
          `Formula exceeds the maximum parenthesis/function nesting depth of ${FORMULA_LIMITS.maxParenthesisDepth}.`,
          {
            position: stripped.base + (t.startOffset ?? 0),
            line: t.startLine,
            column: t.startColumn
          }
        );
    } else if (tokenMatcher(t, RParen))
      parenDepth = Math.max(0, parenDepth - 1);
  }
  parser.input = lex.tokens;
  let ast: FormulaNode;
  try {
    ast = parser.expression();
  } catch (error) {
    if (error instanceof DcmsRuleError) throw error;
    if (error instanceof RangeError)
      throw new DcmsRuleError(
        "FORMULA_LIMIT_EXCEEDED",
        "Formula nesting exceeds parser capacity."
      );
    throw new DcmsRuleError(
      "FORMULA_SYNTAX_ERROR",
      error instanceof Error ? error.message : String(error),
      { cause: error }
    );
  }
  if (parser.errors.length) {
    const e = parser.errors[0],
      tok = e.token;
    const atEnd = tok.tokenType.name === "EOF" || tok.image === "";
    throw new DcmsRuleError(
      atEnd ? "FORMULA_INCOMPLETE" : "FORMULA_SYNTAX_ERROR",
      e.message,
      {
        position: stripped.base + (tok.startOffset ?? stripped.text.length),
        line: tok.startLine,
        column: tok.startColumn,
        length: tok.image?.length
      }
    );
  }
  const stack = [{ node: ast, depth: 1 }];
  let nodes = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (
      ++nodes > FORMULA_LIMITS.maxAstNodes ||
      depth > FORMULA_LIMITS.maxAstDepth
    )
      throw new DcmsRuleError(
        "FORMULA_LIMIT_EXCEEDED",
        "Formula exceeds the AST size/depth limit.",
        { position: node.span?.startOffset }
      );
    if (
      node.kind === "literal" &&
      typeof node.value === "number" &&
      !Number.isFinite(node.value)
    )
      throw new DcmsRuleError(
        "FORMULA_INVALID_RESULT",
        "Numeric literal must be finite.",
        { position: (node.span?.startOffset ?? 0) + stripped.base }
      );
    if (node.kind === "unary")
      stack.push({ node: node.value, depth: depth + 1 });
    if (node.kind === "binary")
      stack.push(
        { node: node.left, depth: depth + 1 },
        { node: node.right, depth: depth + 1 }
      );
    if (node.kind === "call")
      for (const child of node.args)
        stack.push({ node: child, depth: depth + 1 });
  }
  return shiftSpan(ast, stripped.base);
}

export const FORMULA_LANGUAGE_TOKENS: readonly TokenType[] = allTokens;
