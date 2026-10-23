/**
 * Parser/evaluator for the separate Required Keywords language.
 *
 * Why this remains separate from formulas: Required Keywords is literal text search with its own uppercase logical
 * operators, implicit-OR behavior, diagnostics, and limits. It is deliberately not regex and not Formula.js syntax.
 */
import {
  createToken,
  createTokenInstance,
  EmbeddedActionsParser,
  Lexer,
  type IToken
} from "chevrotain";
import type {
  KeywordNode,
  KeywordParseResult,
  KeywordParseWarning,
  SourceSpan
} from "./types.js";
import { DcmsRuleError } from "./errors.js";
import { KEYWORD_LIMITS } from "./limits.js";

/**
 * Required Keywords language v2.1:
 * - AND / OR / NOT are case-sensitive operators and must be uppercase.
 * - whitespace-separated adjacent expressions use implicit OR.
 * - quoted phrases remain one literal.
 */
export const DCMS_KEYWORD_LANGUAGE_VERSION = "2.1" as const;

const KWhiteSpace = createToken({
  name: "KWhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED
});
const KAnd = createToken({ name: "KAnd", pattern: /AND(?![^\s()"])/ });
const KOr = createToken({ name: "KOr", pattern: /OR(?![^\s()"])/ });
const KNot = createToken({ name: "KNot", pattern: /NOT(?![^\s()"])/ });
const KLParen = createToken({ name: "KLParen", pattern: /\(/ });
const KRParen = createToken({ name: "KRParen", pattern: /\)/ });
const KQuoted = createToken({
  name: "KQuoted",
  pattern: /"(?:\\["\\]|[^"\\])*"/,
  line_breaks: true
});
const KTerm = createToken({ name: "KTerm", pattern: /[^\s()"]+/ });
const kTokens = [
  KWhiteSpace,
  KAnd,
  KOr,
  KNot,
  KLParen,
  KRParen,
  KQuoted,
  KTerm
];
const keywordLexer = new Lexer(kTokens, { positionTracking: "full" });

function span(t: IToken): SourceSpan {
  return {
    startOffset: t.startOffset ?? 0,
    endOffset: t.endOffset ?? t.startOffset ?? 0,
    startLine: t.startLine,
    startColumn: t.startColumn,
    endLine: t.endLine,
    endColumn: t.endColumn
  };
}
function merge(a?: SourceSpan, b?: SourceSpan): SourceSpan | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    startOffset: a.startOffset,
    endOffset: b.endOffset,
    startLine: a.startLine,
    startColumn: a.startColumn,
    endLine: b.endLine,
    endColumn: b.endColumn
  };
}
function quotedValue(image: string): string {
  return image.slice(1, -1).replace(/\\(["\\])/g, "$1");
}

function endsExpression(t: IToken): boolean {
  return (
    t.tokenType === KQuoted || t.tokenType === KTerm || t.tokenType === KRParen
  );
}
function startsExpression(t: IToken): boolean {
  return (
    t.tokenType === KQuoted ||
    t.tokenType === KTerm ||
    t.tokenType === KLParen ||
    t.tokenType === KNot
  );
}
function hasWhitespaceGap(input: string, left: IToken, right: IToken): boolean {
  const start = (left.endOffset ?? left.startOffset ?? 0) + 1;
  const end = right.startOffset ?? start;
  return end > start && /\s/.test(input.slice(start, end));
}
function warning(
  code: KeywordParseWarning["code"],
  message: string,
  t?: IToken
): KeywordParseWarning {
  return { code, message, position: t?.startOffset, length: t?.image?.length };
}

/** Insert synthetic OR tokens only where two expressions are separated by whitespace. */
function normalizeKeywordTokens(
  input: string,
  tokens: IToken[]
): { tokens: IToken[]; warnings: KeywordParseWarning[] } {
  const normalized: IToken[] = [];
  const warnings: KeywordParseWarning[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    normalized.push(current);
    if (
      current.tokenType === KTerm &&
      /^(and|or|not)$/i.test(current.image) &&
      !/^(AND|OR|NOT)$/.test(current.image)
    ) {
      warnings.push(
        warning(
          "KEYWORD_OPERATOR_CASE",
          `Operators are case-sensitive. '${current.image}' is being treated as a keyword; use AND, OR, or NOT in uppercase for operators.`,
          current
        )
      );
    }
    const next = tokens[i + 1];
    if (
      next &&
      endsExpression(current) &&
      startsExpression(next) &&
      hasWhitespaceGap(input, current, next)
    ) {
      const pos = next.startOffset ?? (current.endOffset ?? 0) + 1;
      normalized.push(
        createTokenInstance(
          KOr,
          "OR",
          pos,
          pos,
          next.startLine ?? 1,
          next.startLine ?? 1,
          next.startColumn ?? 1,
          next.startColumn ?? 1
        )
      );
      warnings.push(
        warning(
          "KEYWORD_IMPLICIT_OR",
          "Spaces between search terms are treated as OR. Use AND to require all terms.",
          next
        )
      );
    }
  }
  return { tokens: normalized, warnings };
}

class KeywordParser extends EmbeddedActionsParser {
  expression!: () => KeywordNode;
  orExpression!: () => KeywordNode;
  andExpression!: () => KeywordNode;
  notExpression!: () => KeywordNode;
  primary!: () => KeywordNode;
  constructor() {
    super(kTokens, { recoveryEnabled: false });
    const $ = this;
    $.expression = $.RULE(
      "expression",
      () => $.SUBRULE($.orExpression) as KeywordNode
    );
    $.orExpression = $.RULE("orExpression", () => {
      let left = $.SUBRULE($.andExpression) as KeywordNode;
      $.MANY(() => {
        $.CONSUME(KOr);
        const right = $.SUBRULE2($.andExpression) as KeywordNode;
        left = { kind: "or", left, right, span: merge(left.span, right.span) };
      });
      return left;
    });
    $.andExpression = $.RULE("andExpression", () => {
      let left = $.SUBRULE($.notExpression) as KeywordNode;
      $.MANY(() => {
        $.CONSUME(KAnd);
        const right = $.SUBRULE2($.notExpression) as KeywordNode;
        left = { kind: "and", left, right, span: merge(left.span, right.span) };
      });
      return left;
    });
    $.notExpression = $.RULE(
      "notExpression",
      () =>
        $.OR([
          {
            ALT: () => {
              const n = $.CONSUME(KNot);
              const value = $.SUBRULE($.notExpression) as KeywordNode;
              return {
                kind: "not",
                value,
                span: merge(span(n), value.span)
              } as KeywordNode;
            }
          },
          { ALT: () => $.SUBRULE($.primary) as KeywordNode }
        ]) as KeywordNode
    );
    $.primary = $.RULE(
      "primary",
      () =>
        $.OR([
          {
            ALT: () => {
              const t = $.CONSUME(KQuoted);
              return {
                kind: "term",
                value: quotedValue(t.image),
                span: span(t)
              } as KeywordNode;
            }
          },
          {
            ALT: () => {
              const t = $.CONSUME(KTerm);
              return {
                kind: "term",
                value: t.image,
                span: span(t)
              } as KeywordNode;
            }
          },
          {
            ALT: () => {
              const l = $.CONSUME(KLParen);
              const n = $.SUBRULE($.expression) as KeywordNode;
              const r = $.CONSUME(KRParen);
              return { ...n, span: merge(span(l), span(r)) } as KeywordNode;
            }
          }
        ]) as KeywordNode
    );
    this.performSelfAnalysis();
  }
}
const parser = new KeywordParser();
function assertKeywordAstLimits(
  node: KeywordNode,
  state = { nodes: 0, depth: 0 },
  depth = 1
): void {
  state.nodes++;
  state.depth = Math.max(state.depth, depth);
  if (state.nodes > KEYWORD_LIMITS.maxAstNodes)
    throw new DcmsRuleError(
      "KEYWORD_LIMIT_EXCEEDED",
      `Required Keywords expression exceeds the maximum node count of ${KEYWORD_LIMITS.maxAstNodes}.`,
      { position: node.span?.startOffset }
    );
  switch (node.kind) {
    case "term":
      return;
    case "not":
      assertKeywordAstLimits(node.value, state, depth + 1);
      return;
    case "and":
    case "or":
      assertKeywordAstLimits(node.left, state, depth + 1);
      assertKeywordAstLimits(node.right, state, depth + 1);
      return;
  }
}

/**
 * Parse literal keyword search with uppercase operators and whitespace-based implicit OR.
 * Return AST plus authoring warnings; malformed or oversized expressions throw controlled errors.
 */
export function parseKeywordExpressionDetailed(
  input: string
): KeywordParseResult {
  if (typeof input !== "string")
    throw new DcmsRuleError(
      "KEYWORD_SYNTAX_ERROR",
      "Required Keywords must be a string."
    );
  if (input.length > KEYWORD_LIMITS.maxExpressionLength)
    throw new DcmsRuleError(
      "KEYWORD_LIMIT_EXCEEDED",
      `Required Keywords expression exceeds the maximum length of ${KEYWORD_LIMITS.maxExpressionLength} characters.`,
      { position: KEYWORD_LIMITS.maxExpressionLength }
    );
  if (!input.trim())
    throw new DcmsRuleError("KEYWORD_EMPTY", "Keyword is required.", 0);
  const lex = keywordLexer.tokenize(input);
  if (lex.errors.length) {
    const e = lex.errors[0];
    throw new DcmsRuleError("KEYWORD_LEXICAL_ERROR", e.message, {
      position: e.offset,
      line: e.line,
      column: e.column,
      length: e.length
    });
  }
  if (
    lex.tokens.filter((t) => t.tokenType !== KLParen && t.tokenType !== KRParen)
      .length > KEYWORD_LIMITS.maxAstNodes
  )
    throw new DcmsRuleError(
      "KEYWORD_LIMIT_EXCEEDED",
      "Required Keywords exceeds the token/node limit."
    );
  let parenDepth = 0;
  for (const t of lex.tokens) {
    if (t.tokenType === KLParen) {
      parenDepth++;
      if (parenDepth > KEYWORD_LIMITS.maxParenthesisDepth)
        throw new DcmsRuleError(
          "KEYWORD_LIMIT_EXCEEDED",
          `Required Keywords expression exceeds the maximum parenthesis depth of ${KEYWORD_LIMITS.maxParenthesisDepth}.`,
          { position: t.startOffset, line: t.startLine, column: t.startColumn }
        );
    } else if (t.tokenType === KRParen)
      parenDepth = Math.max(0, parenDepth - 1);
    if (t.tokenType === KQuoted || t.tokenType === KTerm) {
      const v = t.tokenType === KQuoted ? quotedValue(t.image) : t.image;
      if (v.length > KEYWORD_LIMITS.maxLiteralLength)
        throw new DcmsRuleError(
          "KEYWORD_LIMIT_EXCEEDED",
          `Keyword literal exceeds the maximum length of ${KEYWORD_LIMITS.maxLiteralLength} characters.`,
          {
            position: t.startOffset,
            line: t.startLine,
            column: t.startColumn,
            length: t.image.length
          }
        );
    }
  }
  const normalized = normalizeKeywordTokens(input, lex.tokens);
  parser.input = normalized.tokens;
  let ast: KeywordNode;
  try {
    ast = parser.expression();
  } catch (e) {
    if (e instanceof RangeError)
      throw new DcmsRuleError(
        "KEYWORD_LIMIT_EXCEEDED",
        "Required Keywords nesting exceeds parser capacity."
      );
    throw e;
  }
  if (parser.errors.length) {
    const e = parser.errors[0],
      tok = e.token,
      atEnd = tok.tokenType.name === "EOF" || tok.image === "";
    const redundant = /Redundant input/i.test(e.message);
    const message = redundant
      ? `Adjacent search terms without whitespace require AND/OR, or add whitespace to use implicit OR near '${tok.image}'.`
      : e.message;
    throw new DcmsRuleError(
      atEnd ? "KEYWORD_INCOMPLETE" : "KEYWORD_SYNTAX_ERROR",
      message,
      {
        position: tok.startOffset ?? input.length,
        line: tok.startLine,
        column: tok.startColumn,
        length: tok.image?.length
      }
    );
  }
  assertKeywordAstLimits(ast);
  return { ast, warnings: normalized.warnings };
}

/**
 * Return only the keyword AST, discarding warnings. Editors should use the detailed parser.
 */
export function parseKeywordExpression(input: string): KeywordNode {
  return parseKeywordExpressionDetailed(input).ast;
}
function evaluateKeywordNormalized(
  node: KeywordNode,
  hay: string,
  caseSensitive: boolean
): boolean {
  switch (node.kind) {
    case "term": {
      const needle = caseSensitive ? node.value : node.value.toLowerCase();
      return hay.includes(needle);
    }
    case "not":
      return !evaluateKeywordNormalized(node.value, hay, caseSensitive);
    case "and":
      return (
        evaluateKeywordNormalized(node.left, hay, caseSensitive) &&
        evaluateKeywordNormalized(node.right, hay, caseSensitive)
      );
    case "or":
      return (
        evaluateKeywordNormalized(node.left, hay, caseSensitive) ||
        evaluateKeywordNormalized(node.right, hay, caseSensitive)
      );
  }
}
/**
 * Match a trusted keyword AST against text with literal substring semantics, never regex.
 * Case-insensitive mode lowercases both terms and text; Boolean nodes short-circuit.
 */
export function evaluateKeyword(
  node: KeywordNode,
  value: string,
  caseSensitive: boolean
): boolean {
  const hay = caseSensitive ? value : value.toLowerCase();
  return evaluateKeywordNormalized(node, hay, caseSensitive);
}
