/**
 * Shared structural guards for authored JSON and runtime data.
 * These checks turn malformed or oversized input into controlled errors before recursive parsers,
 * third-party functions, or authoritative Submit decisions can consume it.
 */
import { DcmsRuleError, type DcmsRuleErrorCode } from "./errors.js";
import { DATA_LIMITS, DEFINITION_LIMITS } from "./limits.js";
import type {
  DcmsValue,
  FormDefinition,
  RevisionDefinition,
  ValidationRuleInput
} from "./types.js";

/**
 * Recognize ordinary or null-prototype objects; arrays and class instances are excluded.
 */
export function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
/**
 * Require a plain data object and reject accessor properties before reading its values.
 */
export function requireObject(
  value: unknown,
  path: string,
  code: DcmsRuleErrorCode = "PAYLOAD_INVALID"
): asserts value is Record<string, unknown> {
  if (!plainObject(value))
    throw new DcmsRuleError(code, `${path} must be a plain object.`);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value)
  )) {
    if (descriptor.get || descriptor.set)
      throw new DcmsRuleError(
        code,
        `${path} must contain data properties only.`
      );
  }
}
/**
 * Reject enumerable string keys outside the allowed JSON contract; does not check required keys.
 */
export function requireKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  code: DcmsRuleErrorCode = "PAYLOAD_INVALID"
): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw new DcmsRuleError(
        code,
        `${path} contains unknown property ${key}.`
      );
}
/**
 * Require a non-blank, length-limited identifier without trimming or rewriting the identifier.
 */
export function requireId(
  value: unknown,
  path: string,
  code: DcmsRuleErrorCode = "PAYLOAD_INVALID"
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > DEFINITION_LIMITS.maxIdentifierLength
  ) {
    throw new DcmsRuleError(
      code,
      `${path} must be a non-blank string of at most ${DEFINITION_LIMITS.maxIdentifierLength} characters.`
    );
  }
}
/**
 * Accept a finite numeric version or non-blank string version; does not impose ordering.
 */
export function requireVersion(
  value: unknown,
  path: string,
  code: DcmsRuleErrorCode = "PAYLOAD_INVALID"
): void {
  if (
    !(
      (typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.trim() && value.length <= 256)
    )
  ) {
    throw new DcmsRuleError(
      code,
      `${path} must be a finite number or non-blank string of at most 256 characters.`
    );
  }
}
export interface ValueBudget {
  nodes: number;
  characters: number;
}
/**
 * Create mutable counters to share across values when enforcing an aggregate input budget.
 */
export function valueBudget(): ValueBudget {
  return { nodes: 0, characters: 0 };
}
/**
 * Check finite JSON-like values with an explicit work stack and depth/node/character limits.
 * Objects, undefined and sparse array entries are invalid. Passing the same budget
 * accumulates cost across values; output=true selects the separate result ceilings.
 */
export function assertDcmsValue(
  value: unknown,
  path = "value",
  budget = valueBudget(),
  output = false
): asserts value is DcmsValue {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const maxNodes = output
    ? DATA_LIMITS.maxOutputNodes
    : DATA_LIMITS.maxValueNodes;
  const maxChars = output
    ? DATA_LIMITS.maxOutputCharacters
    : DATA_LIMITS.maxInputCharacters;
  while (stack.length) {
    const { value: item, depth } = stack.pop()!;
    if (++budget.nodes > maxNodes || depth > DATA_LIMITS.maxArrayDepth)
      throw new DcmsRuleError(
        "FORMULA_LIMIT_EXCEEDED",
        `${path} exceeds the value size/depth limit.`
      );
    if (Array.isArray(item)) {
      if (item.length > maxNodes - budget.nodes)
        throw new DcmsRuleError(
          "FORMULA_LIMIT_EXCEEDED",
          `${path} exceeds the array size limit.`
        );
      for (let i = item.length - 1; i >= 0; i--)
        stack.push({ value: item[i], depth: depth + 1 });
    } else if (typeof item === "string") {
      budget.characters += item.length;
      if (budget.characters > maxChars)
        throw new DcmsRuleError(
          "FORMULA_LIMIT_EXCEEDED",
          `${path} exceeds the character budget of ${maxChars}.`
        );
    } else if (
      !(
        item === null ||
        typeof item === "boolean" ||
        (typeof item === "number" && Number.isFinite(item))
      )
    ) {
      throw new DcmsRuleError(
        "PAYLOAD_INVALID",
        `${path} must contain only BLANK, finite numbers, strings, Booleans, and arrays of these values.`
      );
    }
  }
}
function stringProperty(
  value: unknown,
  path: string,
  optional = false,
  nullable = false,
  max: number = DEFINITION_LIMITS.maxLabelLength
): void {
  if ((optional && value === undefined) || (nullable && value === null)) return;
  if (typeof value !== "string" || value.length > max)
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path} must be a string of at most ${max} characters.`
    );
}
function boolProperty(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean")
    throw new DcmsRuleError("DEFINITION_INVALID", `${path} must be a Boolean.`);
}
/**
 * Check a rule or row object structurally; criterion/operator semantics are checked separately.
 */
export function assertRuleShape(
  value: unknown,
  path = "rule",
  row = false
): asserts value is ValidationRuleInput {
  requireObject(value, path, "DEFINITION_INVALID");
  requireKeys(
    value,
    row
      ? [
          "id",
          "label",
          "expression",
          "resultLabel",
          "resultUnit",
          "failureMessage",
          "operator",
          "criteria",
          "keyword",
          "caseSensitive"
        ]
      : ["operator", "criteria", "keyword", "caseSensitive"],
    path,
    "DEFINITION_INVALID"
  );
  if (row) {
    requireId(value.id, `${path}.id`, "DEFINITION_INVALID");
    stringProperty(value.label, `${path}.label`, true);
    stringProperty(value.expression, `${path}.expression`, true, true, 8192);
    stringProperty(value.resultLabel, `${path}.resultLabel`, true);
    stringProperty(value.resultUnit, `${path}.resultUnit`, true);
    stringProperty(value.failureMessage, `${path}.failureMessage`, true);
  }
  boolProperty(value.caseSensitive, `${path}.caseSensitive`);
  const k = value.keyword;
  if (
    !(
      typeof k === "string" ||
      (typeof k === "number" && Number.isFinite(k)) ||
      (Array.isArray(k) &&
        k.length <= DEFINITION_LIMITS.maxSelectionValues &&
        k.every((x) => typeof x === "string"))
    )
  ) {
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path}.keyword must be text, a finite number, or a string array.`
    );
  }
  if (typeof k === "string" && k.length > 16384)
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path}.keyword is too long.`
    );
  if (Array.isArray(k) && k.some((x) => !x.trim() || x.length > 8192))
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path}.keyword contains a blank or oversized selection.`
    );
  if (typeof value.criteria !== "string")
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path}.criteria is required.`
    );
  if (value.criteria === "required_keywords" && typeof k !== "string")
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path}.keyword must be text for Required Keywords.`
    );
  if (
    (value.criteria.startsWith("number_") ||
      value.criteria.startsWith("character_limit_")) &&
    Array.isArray(k)
  )
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `${path}.keyword must be a scalar numeric threshold.`
    );
}
/**
 * Check Form structure, size limits and mutually exclusive rule representations before compilation.
 */
export function assertFormShape(
  value: unknown
): asserts value is FormDefinition {
  requireObject(value, "Form", "DEFINITION_INVALID");
  requireKeys(
    value,
    ["formId", "version", "fields"],
    "Form",
    "DEFINITION_INVALID"
  );
  requireId(value.formId, "Form.formId", "DEFINITION_INVALID");
  requireVersion(value.version, "Form.version", "DEFINITION_INVALID");
  if (
    !Array.isArray(value.fields) ||
    value.fields.length > DEFINITION_LIMITS.maxFields
  )
    throw new DcmsRuleError(
      "DEFINITION_INVALID",
      `Form.fields must be an array with at most ${DEFINITION_LIMITS.maxFields} fields.`
    );
  let rows = 0;
  for (const f of value.fields) {
    requireObject(f, "Field", "DEFINITION_INVALID");
    requireKeys(
      f,
      [
        "id",
        "label",
        "valueType",
        "inputUnit",
        "mustBeCorrect",
        "validationRows",
        "expression",
        "validations",
        "formulaValidations"
      ],
      "Field",
      "DEFINITION_INVALID"
    );
    requireId(f.id, "Field.id", "DEFINITION_INVALID");
    stringProperty(f.label, "Field.label");
    stringProperty(f.inputUnit, "Field.inputUnit", true);
    boolProperty(f.mustBeCorrect, "Field.mustBeCorrect");
    stringProperty(f.expression, "Field.expression", true, true, 8192);
    let populated = 0;
    for (const prop of [
      "validationRows",
      "validations",
      "formulaValidations"
    ]) {
      const rs = f[prop];
      if (rs === undefined) continue;
      if (!Array.isArray(rs) || rs.length > DEFINITION_LIMITS.maxRowsPerField)
        throw new DcmsRuleError(
          "DEFINITION_INVALID",
          `${prop} must be an array with at most ${DEFINITION_LIMITS.maxRowsPerField} rows.`
        );
      if (rs.length) populated++;
      rows += rs.length;
      if (rows > DEFINITION_LIMITS.maxRowsPerForm)
        throw new DcmsRuleError(
          "DEFINITION_INVALID",
          "Form exceeds the total validation-row limit."
        );
      for (const r of rs) {
        if (prop === "formulaValidations") {
          requireObject(r, "Formula validation", "DEFINITION_INVALID");
          requireKeys(
            r,
            ["id", "label", "expression", "validation"],
            "Formula validation",
            "DEFINITION_INVALID"
          );
          requireId(r.id, "Formula validation.id", "DEFINITION_INVALID");
          stringProperty(r.label, "Formula validation.label", true);
          stringProperty(
            r.expression,
            "Formula validation.expression",
            false,
            false,
            8192
          );
          assertRuleShape(r.validation);
        } else assertRuleShape(r, prop, prop === "validationRows");
      }
    }
    if (
      populated > 1 ||
      (typeof f.expression === "string" &&
        f.expression.trim() &&
        ((f.validationRows as unknown[] | undefined)?.length ||
          (f.formulaValidations as unknown[] | undefined)?.length))
    )
      throw new DcmsRuleError(
        "DEFINITION_INVALID",
        "A field must use one validation representation; field expressions cannot be mixed with row formulas."
      );
  }
}
/**
 * Check Revision structure and each contained Form; duplicate identities are checked separately.
 */
export function assertRevisionShape(
  value: unknown
): asserts value is RevisionDefinition {
  requireObject(value, "Revision", "REVISION_DEFINITION_INVALID");
  requireKeys(
    value,
    ["revisionId", "version", "formElements"],
    "Revision",
    "REVISION_DEFINITION_INVALID"
  );
  requireId(
    value.revisionId,
    "Revision.revisionId",
    "REVISION_DEFINITION_INVALID"
  );
  requireVersion(
    value.version,
    "Revision.version",
    "REVISION_DEFINITION_INVALID"
  );
  if (
    !Array.isArray(value.formElements) ||
    !value.formElements.length ||
    value.formElements.length > DEFINITION_LIMITS.maxFormElements
  )
    throw new DcmsRuleError(
      "REVISION_DEFINITION_INVALID",
      `Revision requires 1 to ${DEFINITION_LIMITS.maxFormElements} Form Elements.`
    );
  for (const e of value.formElements) {
    requireObject(e, "Form Element", "REVISION_DEFINITION_INVALID");
    requireKeys(
      e,
      ["nodeId", "label", "form"],
      "Form Element",
      "REVISION_DEFINITION_INVALID"
    );
    requireId(e.nodeId, "Form Element.nodeId", "REVISION_DEFINITION_INVALID");
    stringProperty(e.label, "Form Element.label", true);
    assertFormShape(e.form);
  }
}
/** Definitions are snapshotted so later editor mutations cannot change an already compiled Submit rule. */
export function frozenSnapshot<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const out: any = Array.isArray(value) ? [] : Object.create(null);
  for (const [k, v] of Object.entries(value)) out[k] = frozenSnapshot(v);
  return Object.freeze(out);
}
