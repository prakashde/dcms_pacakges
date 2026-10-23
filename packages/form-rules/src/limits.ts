/**
 * Versioned DCMS authoring/runtime safety limits.
 * These are part of the controlled formula/rule contract and are checked before
 * expensive parsing/evaluation work where possible.
 */
export const DCMS_RULE_LIMITS_VERSION = "3" as const;

export const FORMULA_LIMITS = Object.freeze({
  /** Matches the practical scale of Excel-style authored formulas without promising Excel compatibility. */
  maxSourceLength: 8192,
  /** Maximum nested parenthesis/function depth accepted by the lexer/parser boundary. */
  maxParenthesisDepth: 64,
  /** Maximum prepared AST nodes in one formula. */
  maxAstNodes: 4096,
  /** Maximum recursive expression depth after parsing. */
  maxAstDepth: 128,
  /** Maximum arguments supplied to one function call. */
  maxFunctionArguments: 255,
  /** Maximum unique DCMS references collected from one formula. */
  maxReferences: 1024
} as const);

export const KEYWORD_LIMITS = Object.freeze({
  /**
   * Required Keywords expressions may contain long quoted phrases/paragraph fragments.
   * This is a definition-size ceiling; it does not depend on the current field value.
   */
  maxExpressionLength: 16384,
  /**
   * One quoted/bare literal may be long enough to represent a paragraph-sized required phrase.
   * Target text length is governed separately by the Form field/application input policy.
   */
  maxLiteralLength: 8192,
  maxParenthesisDepth: 32,
  maxAstNodes: 512
} as const);

/** Resource ceilings are versioned behavior, not response-time guarantees for third-party functions. */
export const DATA_LIMITS = Object.freeze({
  maxInputCharacters: 8 * 1024 * 1024,
  maxOutputCharacters: 1024 * 1024,
  maxValueNodes: 100000,
  maxOutputNodes: 10000,
  maxArrayDepth: 32,
  maxFunctionIterations: 100000
});
export const DEFINITION_LIMITS = Object.freeze({
  maxFields: 5000,
  maxRowsPerField: 256,
  maxRowsPerForm: 50000,
  maxFormElements: 100,
  maxIdentifierLength: 256,
  maxLabelLength: 4096,
  maxSelectionValues: 10000
});
