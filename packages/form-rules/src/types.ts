/**
 * Shared DCMS rules-engine contracts.
 *
 * Why this file exists: React, Express, JSON adapters, tests, and the compiler must agree on one vocabulary for
 * authored rules and evaluated results. Central contracts prevent presentation-specific assumptions from becoming
 * hidden server behavior.
 */
/** DCMS BLANK is represented internally as null. It is distinct from 0, false and the empty string. */
export type DcmsBlank = null;
export const DCMS_BLANK: DcmsBlank = null;
/**
 * Recognize the DCMS BLANK value (null); empty strings, zero and false remain distinct values.
 */
export function isDcmsBlank(value: unknown): value is DcmsBlank {
  return value === null;
}

export type DcmsScalar = number | string | boolean | DcmsBlank;
export type DcmsValue = DcmsScalar | DcmsValue[];
/** Compatibility alias retained for v0.7 callers. */
export type Scalar = DcmsValue;

export interface SourceSpan {
  startOffset: number;
  endOffset: number;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export type FormulaNode =
  | { kind: "literal"; value: DcmsScalar; span?: SourceSpan }
  | { kind: "reference"; name: string; span?: SourceSpan }
  | {
      kind: "unary";
      op: "+" | "-" | "NOT";
      value: FormulaNode;
      span?: SourceSpan;
    }
  | {
      kind: "binary";
      op:
        | "+"
        | "-"
        | "*"
        | "/"
        | "^"
        | "&"
        | "="
        | "<>"
        | "<"
        | "<="
        | ">"
        | ">="
        | "AND"
        | "OR";
      left: FormulaNode;
      right: FormulaNode;
      span?: SourceSpan;
    }
  | { kind: "call"; name: string; args: FormulaNode[]; span?: SourceSpan };

export type PreparedFormulaNode =
  | { kind: "literal"; value: DcmsScalar; span?: SourceSpan }
  | { kind: "value"; span?: SourceSpan }
  | { kind: "reference"; name: string; span?: SourceSpan }
  | {
      kind: "unary";
      op: "+" | "-" | "NOT";
      value: PreparedFormulaNode;
      span?: SourceSpan;
    }
  | {
      kind: "binary";
      op:
        | "+"
        | "-"
        | "*"
        | "/"
        | "^"
        | "&"
        | "="
        | "<>"
        | "<"
        | "<="
        | ">"
        | ">="
        | "AND"
        | "OR";
      left: PreparedFormulaNode;
      right: PreparedFormulaNode;
      span?: SourceSpan;
    }
  | {
      kind: "call";
      name: string;
      functionId: number;
      args: PreparedFormulaNode[];
      span?: SourceSpan;
    };

export interface PreparedFormula {
  source: string;
  ast: FormulaNode;
  root: PreparedFormulaNode;
  references: string[];
  functionIds: number[];
  registryFingerprint: string;
  registryVersion: string;
  formulaJsVersion: string;
  languageVersion: string;
  compilerVersion: string;
  limitsVersion: string;
  sourceHash: string;
  nodeCount: number;
}

/** Compatibility name: v0.8 uses a prepared AST, not a required custom bytecode VM. */
export type FormulaProgram = PreparedFormula;

export type FormulaParseStatus = "valid" | "incomplete" | "invalid";

export type KeywordNode =
  | { kind: "term"; value: string; span?: SourceSpan }
  | { kind: "not"; value: KeywordNode; span?: SourceSpan }
  | { kind: "and"; left: KeywordNode; right: KeywordNode; span?: SourceSpan }
  | { kind: "or"; left: KeywordNode; right: KeywordNode; span?: SourceSpan };

export type KeywordParseWarningCode =
  | "KEYWORD_IMPLICIT_OR"
  | "KEYWORD_OPERATOR_CASE";
export interface KeywordParseWarning {
  code: KeywordParseWarningCode;
  message: string;
  position?: number;
  length?: number;
}
export interface KeywordParseResult {
  ast: KeywordNode;
  warnings: KeywordParseWarning[];
}

export type ValidationCriteria =
  | "required_keywords"
  | "character_limit_less_than"
  | "character_limit_more_than"
  | "character_limit_equal_to"
  | "number_greater_than"
  | "number_less_than"
  | "number_equal_to"
  /** Scalar/Radio compatibility criteria retained from v0.9.1. */
  | "selection_values_include"
  | "selection_values_exclude"
  /** Checkbox set semantics. These four options make ANY/ALL behavior explicit in the saved definition. */
  | "selection_values_include_any"
  | "selection_values_include_all"
  | "selection_values_exclude_any"
  | "selection_values_exclude_all";

export type RowOperator = "AND" | "OR" | "AND NOT" | "OR NOT";

/** UI-neutral semantic validation state. Applications may map these states to colors or other presentation. */
export type FieldValidationState =
  | "not_validated"
  | "valid"
  | "warning"
  | "blocking";
export type EvaluationState = "ok" | "error";

export interface NumericInputBound {
  value: number;
  inclusive: boolean;
}

export interface NumericInputRange {
  lower?: NumericInputBound;
  upper?: NumericInputBound;
  equalTo?: number;
}

export interface TextLengthInputRange {
  minExclusive?: number;
  maxExclusive?: number;
  equalTo?: number;
}

export type FieldInputGuidanceKind =
  | "none"
  | "numeric_range"
  | "text_length"
  | "selection"
  | "required_keywords"
  | "criteria_summary";

/**
 * Structured, presentation-neutral guidance derived from the authored validation rows.
 * A transformed formula is never inverted into a guessed entered-value range.
 */
export interface SelectionInputRequirement {
  mode: "include_any" | "include_all" | "exclude_any" | "exclude_all";
  values: string[];
  caseSensitive: boolean;
}

export interface FieldInputGuidance {
  kind: FieldInputGuidanceKind;
  appliesTo: "entered_value" | "calculated_value" | "mixed";
  display: string;
  complete: boolean;
  rowIds: string[];
  numericRange?: NumericInputRange;
  textLength?: TextLengthInputRange;
  allowedValues?: string[];
  excludedValues?: string[];
  /** Exact structured selection requirements; preferred when Checkbox ANY/ALL semantics are present. */
  selectionRequirements?: SelectionInputRequirement[];
  keywordExpressions?: string[];
}

export interface ValidationRuleInput {
  operator?: RowOperator;
  criteria: ValidationCriteria;
  keyword: string | number | string[];
  caseSensitive?: boolean;
}

/** Preferred model: each validation row may transform the field VALUE before applying its criterion. */
export interface ValidationRowDefinition extends ValidationRuleInput {
  id: string;
  label?: string;
  expression?: string | null;
  /** Human-readable name for the value produced by this row expression. */
  resultLabel?: string;
  /** Unit applied to the calculated value and authored threshold. */
  resultUnit?: string;
  /** Optional friendly introduction; factual rule evidence is still generated by the engine. */
  failureMessage?: string;
}

/** Legacy v0.7 shape retained for source compatibility and converted during compilation. */
export interface FormulaValidationPairInput {
  id: string;
  label?: string;
  expression: string;
  validation: ValidationRuleInput;
}

export interface FieldDefinition {
  id: string;
  label: string;
  valueType: "number" | "string" | "boolean";
  /** Unit of the value entered and stored for this field. */
  inputUnit?: string;
  mustBeCorrect?: boolean;
  validationRows?: ValidationRowDefinition[];
  /** Legacy field-wide expression. */
  expression?: string | null;
  /** Legacy validation list. */
  validations?: ValidationRuleInput[];
  /** Legacy per-formula validation pairs. */
  formulaValidations?: FormulaValidationPairInput[];
}

export interface FormDefinition {
  formId: string;
  version: string | number;
  fields: FieldDefinition[];
}

export interface CompiledValidationRule {
  operator: RowOperator;
  criteria: ValidationCriteria;
  keyword: string | number | string[];
  caseSensitive: boolean;
  keywordAst?: KeywordNode;
  /** Numeric/length criteria are converted once during compilation. */
  numericKeyword?: number;
  /** Selection criteria values are normalized once during compilation so Checkbox set checks stay cheap on input. */
  selectionValues?: string[];
}

export interface CompiledValidationRow {
  definition: ValidationRowDefinition;
  formula?: PreparedFormula;
  references: string[];
  validation: CompiledValidationRule;
}

export interface CompiledField {
  definition: FieldDefinition;
  validationRows: CompiledValidationRow[];
  /** Legacy calculated field expression, retained only for compatibility. */
  legacyFormula?: PreparedFormula;
  fieldDependencies: string[];
  externalReferences: string[];
  inputGuidance: FieldInputGuidance;
}

export interface CompiledFormPlan {
  key: string;
  formId: string;
  version: string | number;
  fields: Map<string, CompiledField>;
  fieldOrder: string[];
  dependents: Map<string, Set<string>>;
  registryFingerprint: string;
  registryVersion: string;
  formulaJsVersion: string;
  languageVersion: string;
  keywordLanguageVersion: string;
  compilerVersion: string;
  limitsVersion: string;
  /** Stable hash of the complete canonical Form definition used to build this plan. */
  sourceHash: string;
}

export interface ValidationRowEvaluation {
  rowId: string;
  label: string;
  expression?: string | null;
  calculatedValue: DcmsValue;
  validationPassed: boolean;
  validationMessage?: string;
  /** Structured evidence used to render unit-aware failure feedback without parsing message text. */
  failureDetail?: ValidationFailureDetail;
  error?: string;
}

/**
 * Portable evidence for one failed validation row.
 *
 * Applications should render this structure directly rather than recover values,
 * units, or criteria by parsing `validationMessage`.
 */
export interface ValidationFailureDetail {
  rowId: string;
  rowLabel: string;
  enteredValue: DcmsValue;
  enteredUnit?: string;
  calculatedValue: DcmsValue;
  calculatedLabel?: string;
  calculatedUnit?: string;
  criteria: ValidationCriteria;
  expected: string | number | string[];
  transformed: boolean;
  authoredMessage?: string;
}

/** Compatibility alias used by v0.7 code. */
export type FormulaValidationEvaluation = ValidationRowEvaluation;

/** Portable diagnostic details; the original human-readable error strings remain available. */
export interface EvaluationErrorDetail {
  code: string;
  category: string;
  message: string;
  rowId?: string;
  position?: number;
  length?: number;
  functionName?: string;
}

export interface FieldEvaluation {
  fieldId: string;
  enteredValue: DcmsValue;
  /** Legacy field-wide calculated value; normally the entered value in the preferred row-expression model. */
  calculatedValue: DcmsValue;
  expressionApplied: boolean;
  validationRowResults: ValidationRowEvaluation[];
  /** Legacy alias retained for v0.7 consumers. */
  formulaValidationResults: ValidationRowEvaluation[];
  /** Structured details for failed, non-error validation rows. */
  failureDetails: ValidationFailureDetail[];
  validationPassed: boolean;
  blocking: boolean;
  failures: string[];
  warnings: string[];
  /** True when one or more validation rows apply to this field. */
  hasValidation: boolean;
  /** Four-state ordinary validation result. Null means evaluation could not complete; inspect evaluationState/evaluationErrors. */
  validationState: FieldValidationState | null;
  /** Formula/runtime evaluation status is deliberately separate from ordinary validation pass/fail state. */
  evaluationState: EvaluationState;
  /** Structured acceptable-input / calculated-criteria guidance derived at compile time. */
  inputGuidance: FieldInputGuidance;
  /** Runtime calculation/evaluation errors are distinct from ordinary validation failures. */
  evaluationErrors: string[];
  /** Stable error codes and original expression offsets for application feedback and logs. */
  evaluationErrorDetails: EvaluationErrorDetail[];
  /** Compatibility shortcut: first runtime evaluation error, when present. */
  error?: string;
}

export interface RecordEvaluation {
  values: Map<string, FieldEvaluation>;
  /** Draft Save is allowed for value-validation failures. Invalid rule definitions are rejected before this stage. */
  canSave: boolean;
  /** Submit is blocked by failed Must Be Correct fields and by any runtime calculation/evaluation error. */
  canSubmit: boolean;
  blockingFieldIds: string[];
  invalidFieldIds: string[];
  warningFieldIds: string[];
  /** Fields with validation rows whose current values pass. */
  validFieldIds: string[];
  /** Fields with no validation rows applied. */
  unvalidatedFieldIds: string[];
  /** Fields containing runtime calculation/evaluation errors. These always block Submit. */
  errorFieldIds: string[];
}

export interface RecordChangeEvaluation {
  evaluation: RecordEvaluation;
  changedFieldIds: string[];
  affectedFieldIds: string[];
  statusChangedFieldIds: string[];
}

export interface CompiledPlanStats {
  fieldCount: number;
  formulaCount: number;
  validationRuleCount: number;
  /** Historical name retained: in v0.8 this reports prepared AST node count, not VM bytecode cells. */
  formulaInstructionCells: number;
  dependencyEdgeCount: number;
}

export interface FormulaEvaluationContext {
  value: DcmsValue;
  references: ReadonlyMap<string, DcmsValue>;
}

export interface EvaluationOptions {
  externalReferences?: ReadonlyMap<string, DcmsValue>;
}

/** Preferred JSON/API boundary for Record values. Runtime evaluation converts this once to a Map. */
export interface RecordValuesPayload {
  formId: string;
  formVersion: string | number;
  values: Record<string, DcmsValue>;
  externalReferences?: Record<string, DcmsValue>;
}

export interface RecordEvaluationJson {
  canSave: boolean;
  canSubmit: boolean;
  blockingFieldIds: string[];
  invalidFieldIds: string[];
  warningFieldIds: string[];
  validFieldIds: string[];
  unvalidatedFieldIds: string[];
  errorFieldIds: string[];
  fields: Record<string, FieldEvaluation>;
}

/** One Form Element / Node inside an authored Revision. */
export interface RevisionFormElementDefinition {
  nodeId: string;
  label?: string;
  form: FormDefinition;
}

export interface RevisionDefinition {
  revisionId: string;
  version: string | number;
  formElements: RevisionFormElementDefinition[];
}

export interface RevisionDefinitionIssue {
  nodeId?: string;
  fieldId?: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface CompiledRevisionFormElement {
  nodeId: string;
  label?: string;
  plan: CompiledFormPlan;
}

export interface CompiledRevisionPlan {
  key: string;
  revisionId: string;
  version: string | number;
  formElements: Map<string, CompiledRevisionFormElement>;
  nodeOrder: string[];
  sourceHash: string;
}

export interface RevisionFormElementEvaluation {
  nodeId: string;
  formId: string;
  validationState: FieldValidationState | null;
  evaluationState: EvaluationState;
  evaluation: RecordEvaluation;
}

export interface RevisionEvaluation {
  formElements: Map<string, RevisionFormElementEvaluation>;
  canSubmit: boolean;
  validNodeIds: string[];
  unvalidatedNodeIds: string[];
  warningNodeIds: string[];
  blockingNodeIds: string[];
  errorNodeIds: string[];
}

export interface RevisionEvaluationOptions {
  externalReferencesByNode?: ReadonlyMap<
    string,
    ReadonlyMap<string, DcmsValue>
  >;
}

export interface RevisionChangeEvaluation {
  evaluation: RevisionEvaluation;
  changedNodeId: string;
  changedFieldIds: string[];
  affectedFieldIds: string[];
  statusChangedFieldIds: string[];
  statusChangedNodeIds: string[];
}

export interface RevisionRecordValuesPayload {
  revisionId: string;
  revisionVersion: string | number;
  formElements: Record<string, RecordValuesPayload>;
}

export interface RevisionFormElementEvaluationJson {
  nodeId: string;
  formId: string;
  validationState: FieldValidationState | null;
  evaluationState: EvaluationState;
  evaluation: RecordEvaluationJson;
}

export interface RevisionEvaluationJson {
  canSubmit: boolean;
  validNodeIds: string[];
  unvalidatedNodeIds: string[];
  warningNodeIds: string[];
  blockingNodeIds: string[];
  errorNodeIds: string[];
  formElements: Record<string, RevisionFormElementEvaluationJson>;
}
