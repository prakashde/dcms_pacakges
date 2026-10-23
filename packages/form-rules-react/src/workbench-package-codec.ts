/**
 * Strict parser and deterministic serializer for portable Workbench packages.
 *
 * This boundary validates transport shape and complete source-value coverage.
 * It does not compile definitions, compare model/definition semantics beyond
 * their portable identities, apply values, or replace an accepted Revision.
 */
import {
  DATA_LIMITS,
  DEFINITION_LIMITS,
  type DcmsValue,
  type FieldDefinition,
  type FormDefinition,
  type ValidationRowDefinition
} from "@dcms/form-rules";
import type {
  WorkbenchFieldModel,
  WorkbenchFormModel
} from "./workbench-model.js";
import {
  DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
  DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
  DCMS_WORKBENCH_PACKAGE_KIND,
  DCMS_WORKBENCH_PACKAGE_MAX_BYTES,
  DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
  type DcmsCompleteRevisionFormV2,
  type DcmsCompleteRevisionMetadataV2,
  type DcmsCompleteRevisionPackageV2,
  type DcmsRecordValuesEntryV2,
  type DcmsRecordValuesPackageV2,
  type DcmsRevisionIdentityV2,
  type DcmsWorkbenchPackageScopeV2,
  type DcmsWorkbenchPackageV2
} from "./workbench-package-contracts.js";

const WORKBENCH_FIELD_CATEGORIES = [
  "Radio",
  "Number",
  "Text",
  "Rich Text",
  "Checkbox"
] as const;
const VALUE_TYPES = ["number", "string", "boolean"] as const;
const WORKBENCH_VALUE_TYPES = ["number", "string"] as const;
const VALIDATION_OPERATORS = ["AND", "OR", "AND NOT", "OR NOT"] as const;
const VALIDATION_CRITERIA = [
  "required_keywords",
  "character_limit_less_than",
  "character_limit_more_than",
  "character_limit_equal_to",
  "number_greater_than",
  "number_less_than",
  "number_equal_to",
  "selection_values_include",
  "selection_values_exclude",
  "selection_values_include_any",
  "selection_values_include_all",
  "selection_values_exclude_any",
  "selection_values_exclude_all"
] as const;

const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 250_000;
const MAX_FINGERPRINT_LENGTH = 4096;
const MAX_SEED_LENGTH = 4096;
const MAX_LEGACY_FIELD_METADATA_LENGTH = 4096;
const UTF8 = new TextEncoder();

export type WorkbenchPackageErrorCode =
  | "PACKAGE_TOO_LARGE"
  | "PACKAGE_JSON_INVALID"
  | "PACKAGE_INVALID"
  | "PACKAGE_SCOPE_MISMATCH"
  | "PACKAGE_DUPLICATE_IDENTITY"
  | "PACKAGE_VALUE_COVERAGE"
  | "PACKAGE_LEGACY_INVALID";

/** Controlled transport-boundary error with a stable code and data path. */
export class WorkbenchPackageError extends Error {
  readonly code: WorkbenchPackageErrorCode;
  readonly path: string;

  constructor(
    code: WorkbenchPackageErrorCode,
    path: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkbenchPackageError";
    this.code = code;
    this.path = path;
  }
}

function fail(
  code: WorkbenchPackageErrorCode,
  path: string,
  message: string,
  options?: ErrorOptions
): never {
  throw new WorkbenchPackageError(code, path, message, options);
}

function utf8Length(text: string): number {
  return UTF8.encode(text).byteLength;
}

function enforceTextSize(text: string, path: string): void {
  const bytes = utf8Length(text);
  if (bytes > DCMS_WORKBENCH_PACKAGE_MAX_BYTES) {
    fail(
      "PACKAGE_TOO_LARGE",
      path,
      `${path} contains ${bytes} UTF-8 bytes; the limit is ${DCMS_WORKBENCH_PACKAGE_MAX_BYTES}.`
    );
  }
}

function parseJsonText(text: string, legacy = false): unknown {
  if (typeof text !== "string") {
    fail(
      legacy ? "PACKAGE_LEGACY_INVALID" : "PACKAGE_JSON_INVALID",
      "$",
      "Workbench package input must be JSON text."
    );
  }
  enforceTextSize(text, "$text");
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(source);
  } catch (cause) {
    fail(
      legacy ? "PACKAGE_LEGACY_INVALID" : "PACKAGE_JSON_INVALID",
      "$",
      `Workbench package JSON could not be parsed: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause instanceof Error ? { cause } : undefined
    );
  }
}

/**
 * Reject values that JSON.stringify would silently rewrite or discard.
 * Parsed JSON naturally satisfies this boundary; serializers call it on
 * caller-owned objects before normalization.
 */
function assertPlainJsonGraph(value: unknown): void {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: "$", depth: 0 }
  ];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > MAX_JSON_NODES || item.depth > MAX_JSON_DEPTH) {
      fail(
        "PACKAGE_INVALID",
        item.path,
        "Workbench package exceeds the JSON node/depth boundary."
      );
    }
    const current = item.value;
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        fail(
          "PACKAGE_INVALID",
          item.path,
          `${item.path} must be a finite number.`
        );
      }
      continue;
    }
    if (Array.isArray(current)) {
      if (Object.getOwnPropertySymbols(current).length) {
        fail(
          "PACKAGE_INVALID",
          item.path,
          `${item.path} must not contain symbol properties.`
        );
      }
      for (const key of Object.getOwnPropertyNames(current)) {
        if (key === "length") continue;
        if (!/^(0|[1-9]\d*)$/.test(key)) {
          fail(
            "PACKAGE_INVALID",
            `${item.path}.${key}`,
            `${item.path} arrays must not contain named properties.`
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
          fail(
            "PACKAGE_INVALID",
            `${item.path}[${key}]`,
            `${item.path} must contain enumerable data properties only.`
          );
        }
      }
      for (let index = current.length - 1; index >= 0; index--) {
        if (!Object.prototype.hasOwnProperty.call(current, index)) {
          fail(
            "PACKAGE_INVALID",
            `${item.path}[${index}]`,
            `${item.path} must not contain sparse array entries.`
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(
          current,
          String(index)
        );
        if (!descriptor || descriptor.get || descriptor.set) {
          fail(
            "PACKAGE_INVALID",
            `${item.path}[${index}]`,
            `${item.path} must contain data properties only.`
          );
        }
        stack.push({
          value: descriptor.value,
          path: `${item.path}[${index}]`,
          depth: item.depth + 1
        });
      }
      continue;
    }
    if (typeof current === "object") {
      const proto = Object.getPrototypeOf(current);
      if (proto !== Object.prototype && proto !== null) {
        fail(
          "PACKAGE_INVALID",
          item.path,
          `${item.path} must be a plain object.`
        );
      }
      if (Object.getOwnPropertySymbols(current).length) {
        fail(
          "PACKAGE_INVALID",
          item.path,
          `${item.path} must not contain symbol properties.`
        );
      }
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor.get || descriptor.set || !descriptor.enumerable) {
          fail(
            "PACKAGE_INVALID",
            `${item.path}.${key}`,
            `${item.path} must contain enumerable data properties only.`
          );
        }
        stack.push({
          value: descriptor.value,
          path: `${item.path}.${key}`,
          depth: item.depth + 1
        });
      }
      continue;
    }
    fail(
      "PACKAGE_INVALID",
      item.path,
      `${item.path} is not a JSON data value.`
    );
  }
}

function requireObject(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(code, path, `${path} must be an object.`);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    fail(code, path, `${path} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(code, `${path}.${key}`, `${path} contains unknown property ${key}.`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(
        code,
        `${path}.${key}`,
        `${path} is missing required property ${key}.`
      );
    }
  }
}

function stringValue(
  value: unknown,
  path: string,
  max: number,
  { nonBlank = false }: { nonBlank?: boolean } = {},
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (nonBlank && !value.trim())
  ) {
    fail(
      code,
      path,
      `${path} must be ${nonBlank ? "a non-blank " : "a "}string of at most ${max} characters.`
    );
  }
  return value;
}

function identifier(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string {
  return stringValue(
    value,
    path,
    DEFINITION_LIMITS.maxIdentifierLength,
    {
      nonBlank: true
    },
    code
  );
}

function label(
  value: unknown,
  path: string,
  max: number = DEFINITION_LIMITS.maxLabelLength,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string {
  return stringValue(value, path, max, {}, code);
}

function version(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    value.length <= DEFINITION_LIMITS.maxIdentifierLength
  ) {
    return value;
  }
  fail(
    code,
    path,
    `${path} must be a finite number or non-blank string of at most ` +
      `${DEFINITION_LIMITS.maxIdentifierLength} characters.`
  );
}

function integer(
  value: unknown,
  path: string,
  minimum: number,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(
      code,
      path,
      `${path} must be an integer greater than or equal to ${minimum}.`
    );
  }
  return value as number;
}

function booleanValue(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): boolean {
  if (typeof value !== "boolean") {
    fail(code, path, `${path} must be a Boolean.`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(code, path, `${path} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function arrayValue(
  value: unknown,
  path: string,
  maximum: number,
  minimum = 0,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    fail(
      code,
      path,
      `${path} must be an array containing ${minimum} to ${maximum} items.`
    );
  }
  return value;
}

function duplicate(
  seen: Set<string>,
  value: string,
  path: string,
  kind: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_DUPLICATE_IDENTITY"
): void {
  if (seen.has(value)) {
    fail(
      code === "PACKAGE_LEGACY_INVALID" ? code : "PACKAGE_DUPLICATE_IDENTITY",
      path,
      `${path} duplicates ${kind} identity ${value}.`
    );
  }
  seen.add(value);
}

interface ValueBudget {
  nodes: number;
  characters: number;
}

function cloneDcmsValue(
  value: unknown,
  path: string,
  budget: ValueBudget,
  depth = 0,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): DcmsValue {
  if (
    ++budget.nodes > DATA_LIMITS.maxValueNodes ||
    depth > DATA_LIMITS.maxArrayDepth
  ) {
    fail(code, path, `${path} exceeds the DCMS value size/depth limit.`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(code, path, `${path} must contain only finite numbers.`);
    }
    return value;
  }
  if (typeof value === "string") {
    budget.characters += value.length;
    if (budget.characters > DATA_LIMITS.maxInputCharacters) {
      fail(
        code,
        path,
        `${path} exceeds the DCMS input character budget of ${DATA_LIMITS.maxInputCharacters}.`
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      cloneDcmsValue(item, `${path}[${index}]`, budget, depth + 1, code)
    );
  }
  fail(
    code,
    path,
    `${path} must contain only BLANK, finite numbers, strings, Booleans, and arrays of these values.`
  );
}

function defineRecordValue(
  target: Record<string, DcmsValue>,
  key: string,
  value: DcmsValue
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  });
}

function valueMap(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): Record<string, DcmsValue> {
  const source = requireObject(value, path, code);
  const entries = Object.entries(source);
  if (entries.length > DEFINITION_LIMITS.maxFields) {
    fail(
      code,
      path,
      `${path} contains more than ${DEFINITION_LIMITS.maxFields} fields.`
    );
  }
  const out: Record<string, DcmsValue> = {};
  const budget: ValueBudget = { nodes: 0, characters: 0 };
  for (const [key, item] of entries) {
    identifier(key, `${path} key`, code);
    defineRecordValue(
      out,
      key,
      cloneDcmsValue(item, `${path}.${key}`, budget, 0, code)
    );
  }
  return out;
}

function sortedValueMap(
  values: Record<string, DcmsValue>
): Record<string, DcmsValue> {
  const out: Record<string, DcmsValue> = {};
  for (const key of Object.keys(values).sort()) {
    defineRecordValue(
      out,
      key,
      cloneDcmsValue(values[key], `values.${key}`, {
        nodes: 0,
        characters: 0
      })
    );
  }
  return out;
}

function sameKeys(
  left: Record<string, DcmsValue>,
  right: Record<string, DcmsValue>,
  path: string
): void {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    fail(
      "PACKAGE_VALUE_COVERAGE",
      path,
      `${path} currentValues and originalValues must contain exactly the same field IDs.`
    );
  }
}

function exactValueKeys(
  values: Record<string, DcmsValue>,
  expected: readonly string[],
  path: string
): void {
  const actual = Object.keys(values).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    const missing = wanted.filter((key) => !actual.includes(key));
    const unknown = actual.filter((key) => !wanted.includes(key));
    fail(
      "PACKAGE_VALUE_COVERAGE",
      path,
      `${path} must contain exactly the packaged field IDs` +
        `${missing.length ? `; missing ${missing.join(", ")}` : ""}` +
        `${unknown.length ? `; unknown ${unknown.join(", ")}` : ""}.`
    );
  }
}

function revisionIdentity(
  value: unknown,
  path: string,
  complete: boolean,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): DcmsRevisionIdentityV2 | DcmsCompleteRevisionMetadataV2 {
  const source = requireObject(value, path, code);
  const required = [
    "productId",
    "revisionId",
    "revisionLabel",
    "documentId",
    ...(complete ? ["seed", "profile"] : [])
  ];
  exactKeys(source, required, [], path, code);
  const base: DcmsRevisionIdentityV2 = {
    productId: identifier(source.productId, `${path}.productId`, code),
    revisionId: identifier(source.revisionId, `${path}.revisionId`, code),
    revisionLabel: label(
      source.revisionLabel,
      `${path}.revisionLabel`,
      undefined,
      code
    ),
    documentId: identifier(source.documentId, `${path}.documentId`, code)
  };
  if (!complete) return base;
  return {
    ...base,
    seed: stringValue(source.seed, `${path}.seed`, MAX_SEED_LENGTH, {}, code),
    profile: identifier(source.profile, `${path}.profile`, code)
  };
}

function stringArray(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string[] {
  return arrayValue(
    value,
    path,
    DEFINITION_LIMITS.maxSelectionValues,
    0,
    code
  ).map((item, index) =>
    stringValue(item, `${path}[${index}]`, 8192, {}, code)
  );
}

function keywordStringArray(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string[] {
  return arrayValue(
    value,
    path,
    DEFINITION_LIMITS.maxSelectionValues,
    0,
    code
  ).map((item, index) =>
    stringValue(item, `${path}[${index}]`, 8192, { nonBlank: true }, code)
  );
}

function validationRow(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): ValidationRowDefinition {
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    ["id", "criteria", "keyword"],
    [
      "label",
      "operator",
      "expression",
      "caseSensitive",
      "resultLabel",
      "resultUnit",
      "failureMessage"
    ],
    path,
    code
  );
  const keywordSource = source.keyword;
  let keyword: string | number | string[];
  if (typeof keywordSource === "string") {
    keyword = stringValue(keywordSource, `${path}.keyword`, 16384, {}, code);
  } else if (
    typeof keywordSource === "number" &&
    Number.isFinite(keywordSource)
  ) {
    keyword = keywordSource;
  } else if (Array.isArray(keywordSource)) {
    keyword = keywordStringArray(keywordSource, `${path}.keyword`, code);
  } else {
    fail(
      code,
      `${path}.keyword`,
      `${path}.keyword must be text, a finite number, or a string array.`
    );
  }
  const row: ValidationRowDefinition = {
    id: identifier(source.id, `${path}.id`, code),
    criteria: enumValue(
      source.criteria,
      VALIDATION_CRITERIA,
      `${path}.criteria`,
      code
    ),
    keyword
  };
  if (source.label !== undefined)
    row.label = label(source.label, `${path}.label`, undefined, code);
  if (source.operator !== undefined)
    row.operator = enumValue(
      source.operator,
      VALIDATION_OPERATORS,
      `${path}.operator`,
      code
    );
  if (source.expression !== undefined) {
    if (source.expression === null) row.expression = null;
    else
      row.expression = stringValue(
        source.expression,
        `${path}.expression`,
        8192,
        {},
        code
      );
  }
  if (source.caseSensitive !== undefined)
    row.caseSensitive = booleanValue(
      source.caseSensitive,
      `${path}.caseSensitive`,
      code
    );
  if (source.resultLabel !== undefined)
    row.resultLabel = label(
      source.resultLabel,
      `${path}.resultLabel`,
      undefined,
      code
    );
  if (source.resultUnit !== undefined)
    row.resultUnit = label(
      source.resultUnit,
      `${path}.resultUnit`,
      undefined,
      code
    );
  if (source.failureMessage !== undefined)
    row.failureMessage = label(
      source.failureMessage,
      `${path}.failureMessage`,
      undefined,
      code
    );
  return row;
}

function validationRows(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): ValidationRowDefinition[] {
  const source = arrayValue(
    value,
    path,
    DEFINITION_LIMITS.maxRowsPerField,
    0,
    code
  );
  const seen = new Set<string>();
  return source.map((item, index) => {
    const row = validationRow(item, `${path}[${index}]`, code);
    duplicate(seen, row.id, `${path}[${index}].id`, "validation-row", code);
    return row;
  });
}

function workbenchField(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): WorkbenchFieldModel {
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    [
      "id",
      "category",
      "label",
      "options",
      "mustBeCorrect",
      "valueType",
      "validationRows"
    ],
    ["richHtml", "originalRichHtml", "acceptableHint", "atlasId", "unit"],
    path,
    code
  );
  const field: WorkbenchFieldModel = {
    id: identifier(source.id, `${path}.id`, code),
    category: enumValue(
      source.category,
      WORKBENCH_FIELD_CATEGORIES,
      `${path}.category`,
      code
    ),
    label: label(source.label, `${path}.label`, undefined, code),
    options: stringArray(source.options, `${path}.options`, code),
    mustBeCorrect: booleanValue(
      source.mustBeCorrect,
      `${path}.mustBeCorrect`,
      code
    ),
    valueType: enumValue(
      source.valueType,
      WORKBENCH_VALUE_TYPES,
      `${path}.valueType`,
      code
    ),
    validationRows: validationRows(
      source.validationRows,
      `${path}.validationRows`,
      code
    )
  };
  if (source.richHtml !== undefined)
    field.richHtml = label(
      source.richHtml,
      `${path}.richHtml`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    );
  if (source.originalRichHtml !== undefined)
    field.originalRichHtml = label(
      source.originalRichHtml,
      `${path}.originalRichHtml`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    );
  if (source.acceptableHint !== undefined)
    field.acceptableHint = label(
      source.acceptableHint,
      `${path}.acceptableHint`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    );
  if (source.atlasId !== undefined)
    field.atlasId = label(
      source.atlasId,
      `${path}.atlasId`,
      MAX_LEGACY_FIELD_METADATA_LENGTH,
      code
    );
  if (source.unit !== undefined)
    field.unit = label(
      source.unit,
      `${path}.unit`,
      MAX_LEGACY_FIELD_METADATA_LENGTH,
      code
    );
  return field;
}

function workbenchModel(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): WorkbenchFormModel {
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    ["schemaVersion", "formId", "formVersion", "fields"],
    [],
    path,
    code
  );
  if (source.schemaVersion !== 1) {
    fail(code, `${path}.schemaVersion`, `${path}.schemaVersion must be 1.`);
  }
  const fieldSource = arrayValue(
    source.fields,
    `${path}.fields`,
    DEFINITION_LIMITS.maxFields,
    0,
    code
  );
  const seen = new Set<string>();
  let totalRows = 0;
  const fields = fieldSource.map((item, index) => {
    const field = workbenchField(item, `${path}.fields[${index}]`, code);
    duplicate(seen, field.id, `${path}.fields[${index}].id`, "field", code);
    totalRows += field.validationRows.length;
    if (totalRows > DEFINITION_LIMITS.maxRowsPerForm) {
      fail(
        code,
        `${path}.fields`,
        `${path} exceeds the total validation-row limit.`
      );
    }
    return field;
  });
  return {
    schemaVersion: 1,
    formId: identifier(source.formId, `${path}.formId`, code),
    formVersion: version(source.formVersion, `${path}.formVersion`, code),
    fields
  };
}

function definitionField(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): FieldDefinition {
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    ["id", "label", "valueType"],
    ["mustBeCorrect", "validationRows", "inputUnit"],
    path,
    code
  );
  const field: FieldDefinition = {
    id: identifier(source.id, `${path}.id`, code),
    label: label(source.label, `${path}.label`, undefined, code),
    valueType: enumValue(
      source.valueType,
      VALUE_TYPES,
      `${path}.valueType`,
      code
    )
  };
  if (source.mustBeCorrect !== undefined)
    field.mustBeCorrect = booleanValue(
      source.mustBeCorrect,
      `${path}.mustBeCorrect`,
      code
    );
  if (source.inputUnit !== undefined)
    field.inputUnit = label(
      source.inputUnit,
      `${path}.inputUnit`,
      undefined,
      code
    );
  if (source.validationRows !== undefined)
    field.validationRows = validationRows(
      source.validationRows,
      `${path}.validationRows`,
      code
    );
  return field;
}

function formDefinition(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): FormDefinition {
  const source = requireObject(value, path, code);
  exactKeys(source, ["formId", "version", "fields"], [], path, code);
  const fieldSource = arrayValue(
    source.fields,
    `${path}.fields`,
    DEFINITION_LIMITS.maxFields,
    0,
    code
  );
  const seen = new Set<string>();
  let totalRows = 0;
  const fields = fieldSource.map((item, index) => {
    const field = definitionField(item, `${path}.fields[${index}]`, code);
    duplicate(seen, field.id, `${path}.fields[${index}].id`, "field", code);
    totalRows += field.validationRows?.length ?? 0;
    if (totalRows > DEFINITION_LIMITS.maxRowsPerForm) {
      fail(
        code,
        `${path}.fields`,
        `${path} exceeds the total validation-row limit.`
      );
    }
    return field;
  });
  return {
    formId: identifier(source.formId, `${path}.formId`, code),
    version: version(source.version, `${path}.version`, code),
    fields
  };
}

function fieldIdsAgree(
  model: WorkbenchFormModel,
  definition: FormDefinition,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): string[] {
  const modelIds = model.fields.map((field) => field.id);
  const definitionIds = definition.fields.map((field) => field.id);
  if (
    modelIds.length !== definitionIds.length ||
    modelIds.some((id, index) => id !== definitionIds[index])
  ) {
    fail(
      code,
      path,
      `${path} model and definition must contain the same ordered field IDs.`
    );
  }
  return modelIds;
}

function recordEntry(value: unknown, path: string): DcmsRecordValuesEntryV2 {
  const source = requireObject(value, path);
  exactKeys(
    source,
    [
      "nodeId",
      "formId",
      "formVersion",
      "definitionFingerprint",
      "currentValues",
      "originalValues"
    ],
    [],
    path
  );
  const currentValues = valueMap(source.currentValues, `${path}.currentValues`);
  const originalValues = valueMap(
    source.originalValues,
    `${path}.originalValues`
  );
  sameKeys(currentValues, originalValues, path);
  return {
    nodeId: identifier(source.nodeId, `${path}.nodeId`),
    formId: identifier(source.formId, `${path}.formId`),
    formVersion: version(source.formVersion, `${path}.formVersion`),
    definitionFingerprint: stringValue(
      source.definitionFingerprint,
      `${path}.definitionFingerprint`,
      MAX_FINGERPRINT_LENGTH,
      { nonBlank: true }
    ),
    currentValues,
    originalValues
  };
}

function completeForm(
  value: unknown,
  path: string,
  code: WorkbenchPackageErrorCode = "PACKAGE_INVALID"
): DcmsCompleteRevisionFormV2 {
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    [
      "nodeId",
      "title",
      "scenario",
      "seed",
      "section",
      "step",
      "docDescription",
      "recordDescription",
      "model",
      "definition",
      "currentValues",
      "originalValues"
    ],
    [],
    path,
    code
  );
  const model = workbenchModel(source.model, `${path}.model`, code);
  const definition = formDefinition(
    source.definition,
    `${path}.definition`,
    code
  );
  if (
    model.formId !== definition.formId ||
    String(model.formVersion) !== String(definition.version)
  ) {
    fail(
      code,
      path,
      `${path} model and definition Form identity/version must agree.`
    );
  }
  const expectedFieldIds = fieldIdsAgree(model, definition, path);
  const currentValues = valueMap(
    source.currentValues,
    `${path}.currentValues`,
    code
  );
  const originalValues = valueMap(
    source.originalValues,
    `${path}.originalValues`,
    code
  );
  exactValueKeys(currentValues, expectedFieldIds, `${path}.currentValues`);
  exactValueKeys(originalValues, expectedFieldIds, `${path}.originalValues`);
  return {
    nodeId: identifier(source.nodeId, `${path}.nodeId`, code),
    title: label(source.title, `${path}.title`, undefined, code),
    scenario: identifier(source.scenario, `${path}.scenario`, code),
    seed: stringValue(source.seed, `${path}.seed`, MAX_SEED_LENGTH, {}, code),
    section: integer(source.section, `${path}.section`, 1, code),
    step: integer(source.step, `${path}.step`, 1, code),
    docDescription: label(
      source.docDescription,
      `${path}.docDescription`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    ),
    recordDescription: label(
      source.recordDescription,
      `${path}.recordDescription`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    ),
    model,
    definition,
    currentValues,
    originalValues
  };
}

function rootEnvelope(
  value: unknown,
  expectedScope?: DcmsWorkbenchPackageScopeV2
): Record<string, unknown> {
  assertPlainJsonGraph(value);
  const source = requireObject(value, "$");
  if (source.kind !== DCMS_WORKBENCH_PACKAGE_KIND) {
    fail(
      "PACKAGE_INVALID",
      "$.kind",
      `$.kind must be ${DCMS_WORKBENCH_PACKAGE_KIND}.`
    );
  }
  if (source.schemaVersion !== DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION) {
    fail(
      "PACKAGE_INVALID",
      "$.schemaVersion",
      `$.schemaVersion must be ${DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION}.`
    );
  }
  const scope = enumValue(
    source.scope,
    ["record-values", "complete-revision"],
    "$.scope"
  );
  if (expectedScope && scope !== expectedScope) {
    fail(
      "PACKAGE_SCOPE_MISMATCH",
      "$.scope",
      `Expected ${expectedScope} package scope, received ${scope}.`
    );
  }
  return source;
}

function recordValuesObject(value: unknown): DcmsRecordValuesPackageV2 {
  const source = rootEnvelope(value, "record-values");
  exactKeys(
    source,
    ["kind", "schemaVersion", "scope", "revision", "records"],
    [],
    "$"
  );
  const recordsSource = arrayValue(
    source.records,
    "$.records",
    DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
    1
  );
  const seen = new Set<string>();
  const records = recordsSource.map((item, index) => {
    const entry = recordEntry(item, `$.records[${index}]`);
    duplicate(seen, entry.nodeId, `$.records[${index}].nodeId`, "node");
    return entry;
  });
  return {
    kind: DCMS_WORKBENCH_PACKAGE_KIND,
    schemaVersion: DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
    scope: "record-values",
    revision: revisionIdentity(
      source.revision,
      "$.revision",
      false
    ) as DcmsRevisionIdentityV2,
    records
  };
}

function completeRevisionObject(value: unknown): DcmsCompleteRevisionPackageV2 {
  const source = rootEnvelope(value, "complete-revision");
  exactKeys(
    source,
    ["kind", "schemaVersion", "scope", "revision", "activeNodeId", "forms"],
    [],
    "$"
  );
  const formsSource = arrayValue(
    source.forms,
    "$.forms",
    DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
    1
  );
  const seen = new Set<string>();
  const forms = formsSource.map((item, index) => {
    const form = completeForm(item, `$.forms[${index}]`);
    duplicate(seen, form.nodeId, `$.forms[${index}].nodeId`, "node");
    return form;
  });
  const activeNodeId = identifier(source.activeNodeId, "$.activeNodeId");
  if (!seen.has(activeNodeId)) {
    fail(
      "PACKAGE_INVALID",
      "$.activeNodeId",
      `$.activeNodeId must identify one packaged Form node.`
    );
  }
  return {
    kind: DCMS_WORKBENCH_PACKAGE_KIND,
    schemaVersion: DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
    scope: "complete-revision",
    revision: revisionIdentity(
      source.revision,
      "$.revision",
      true
    ) as DcmsCompleteRevisionMetadataV2,
    activeNodeId,
    forms
  };
}

/** Parse either explicit version-2 package scope without applying it. */
export function parseWorkbenchPackageV2(text: string): DcmsWorkbenchPackageV2 {
  const value = parseJsonText(text);
  const source = rootEnvelope(value);
  return source.scope === "record-values"
    ? recordValuesObject(source)
    : completeRevisionObject(source);
}

/** Parse only the narrow current/original Record-values scope. */
export function parseRecordValuesPackageV2(
  text: string
): DcmsRecordValuesPackageV2 {
  return recordValuesObject(parseJsonText(text));
}

/** Parse only the complete portable Revision scope. */
export function parseCompleteRevisionPackageV2(
  text: string
): DcmsCompleteRevisionPackageV2 {
  return completeRevisionObject(parseJsonText(text));
}

function normalizedValidationRow(
  row: ValidationRowDefinition
): ValidationRowDefinition {
  return {
    id: row.id,
    ...(row.label === undefined ? {} : { label: row.label }),
    ...(row.operator === undefined ? {} : { operator: row.operator }),
    ...(row.expression === undefined ? {} : { expression: row.expression }),
    ...(row.resultLabel === undefined ? {} : { resultLabel: row.resultLabel }),
    ...(row.resultUnit === undefined ? {} : { resultUnit: row.resultUnit }),
    ...(row.failureMessage === undefined
      ? {}
      : { failureMessage: row.failureMessage }),
    criteria: row.criteria,
    keyword: Array.isArray(row.keyword) ? [...row.keyword] : row.keyword,
    ...(row.caseSensitive === undefined
      ? {}
      : { caseSensitive: row.caseSensitive })
  };
}

function normalizedWorkbenchField(
  field: WorkbenchFieldModel
): WorkbenchFieldModel {
  return {
    id: field.id,
    category: field.category,
    label: field.label,
    options: [...field.options],
    mustBeCorrect: field.mustBeCorrect,
    valueType: field.valueType,
    validationRows: field.validationRows.map(normalizedValidationRow),
    ...(field.richHtml === undefined ? {} : { richHtml: field.richHtml }),
    ...(field.originalRichHtml === undefined
      ? {}
      : { originalRichHtml: field.originalRichHtml }),
    ...(field.acceptableHint === undefined
      ? {}
      : { acceptableHint: field.acceptableHint }),
    ...(field.atlasId === undefined ? {} : { atlasId: field.atlasId }),
    ...(field.unit === undefined ? {} : { unit: field.unit })
  };
}

function normalizedModel(model: WorkbenchFormModel): WorkbenchFormModel {
  return {
    schemaVersion: 1,
    formId: model.formId,
    formVersion: model.formVersion,
    fields: model.fields.map(normalizedWorkbenchField)
  };
}

function normalizedDefinitionField(field: FieldDefinition): FieldDefinition {
  return {
    id: field.id,
    label: field.label,
    valueType: field.valueType,
    ...(field.mustBeCorrect === undefined
      ? {}
      : { mustBeCorrect: field.mustBeCorrect }),
    ...(field.inputUnit === undefined ? {} : { inputUnit: field.inputUnit }),
    ...(field.validationRows === undefined
      ? {}
      : {
          validationRows: field.validationRows.map(normalizedValidationRow)
        })
  };
}

function normalizedDefinition(definition: FormDefinition): FormDefinition {
  return {
    formId: definition.formId,
    version: definition.version,
    fields: definition.fields.map(normalizedDefinitionField)
  };
}

function normalizedRecordValuesPackage(
  value: DcmsRecordValuesPackageV2
): DcmsRecordValuesPackageV2 {
  return {
    kind: DCMS_WORKBENCH_PACKAGE_KIND,
    schemaVersion: DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
    scope: "record-values",
    revision: {
      productId: value.revision.productId,
      revisionId: value.revision.revisionId,
      revisionLabel: value.revision.revisionLabel,
      documentId: value.revision.documentId
    },
    records: value.records.map((record) => ({
      nodeId: record.nodeId,
      formId: record.formId,
      formVersion: record.formVersion,
      definitionFingerprint: record.definitionFingerprint,
      currentValues: sortedValueMap(record.currentValues),
      originalValues: sortedValueMap(record.originalValues)
    }))
  };
}

function normalizedCompleteRevisionPackage(
  value: DcmsCompleteRevisionPackageV2
): DcmsCompleteRevisionPackageV2 {
  return {
    kind: DCMS_WORKBENCH_PACKAGE_KIND,
    schemaVersion: DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
    scope: "complete-revision",
    revision: {
      productId: value.revision.productId,
      revisionId: value.revision.revisionId,
      revisionLabel: value.revision.revisionLabel,
      documentId: value.revision.documentId,
      seed: value.revision.seed,
      profile: value.revision.profile
    },
    activeNodeId: value.activeNodeId,
    forms: value.forms.map((form) => ({
      nodeId: form.nodeId,
      title: form.title,
      scenario: form.scenario,
      seed: form.seed,
      section: form.section,
      step: form.step,
      docDescription: form.docDescription,
      recordDescription: form.recordDescription,
      model: normalizedModel(form.model),
      definition: normalizedDefinition(form.definition),
      currentValues: sortedValueMap(form.currentValues),
      originalValues: sortedValueMap(form.originalValues)
    }))
  };
}

function serializeNormalized(value: DcmsWorkbenchPackageV2): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  enforceTextSize(text, "$serialized");
  return text;
}

/** Validate, detach, normalize, and serialize either version-2 package scope. */
export function serializeWorkbenchPackageV2(value: unknown): string {
  const source = rootEnvelope(value);
  const parsed =
    source.scope === "record-values"
      ? recordValuesObject(source)
      : completeRevisionObject(source);
  return serializeNormalized(
    parsed.scope === "record-values"
      ? normalizedRecordValuesPackage(parsed)
      : normalizedCompleteRevisionPackage(parsed)
  );
}

/** Validate and deterministically serialize only the Record-values scope. */
export function serializeRecordValuesPackageV2(value: unknown): string {
  return serializeNormalized(
    normalizedRecordValuesPackage(recordValuesObject(value))
  );
}

/** Validate and deterministically serialize only the complete-Revision scope. */
export function serializeCompleteRevisionPackageV2(value: unknown): string {
  return serializeNormalized(
    normalizedCompleteRevisionPackage(completeRevisionObject(value))
  );
}

export interface LegacyWorkbenchFieldV1 {
  id: string;
  category: WorkbenchFieldModel["category"];
  label: string;
  options: string[];
  mustBeCorrect: boolean;
  valueType: WorkbenchFieldModel["valueType"];
  validationRows: ValidationRowDefinition[];
  value?: DcmsValue;
  richHtml?: string;
  originalRichHtml?: string;
  acceptableHint?: string;
  atlasId?: string;
  unit?: string;
}

export interface LegacyWorkbenchNodeV1 {
  nodeId: string;
  title: string;
  scenario: string;
  seed: string;
  section: number;
  step: number;
  docDescription: string;
  recordDescription: string;
  uiFields: LegacyWorkbenchFieldV1[];
  definition: FormDefinition;
  recordValues: Record<string, DcmsValue>;
  originalRecordValues: Record<string, DcmsValue>;
}

export interface LegacyWorkbenchSeedV1 {
  schema: "dcms-form-validation-seed";
  schemaVersion: 1;
  prototypeVersion?: string;
  exportedAt?: string;
  revision: DcmsCompleteRevisionMetadataV2 & {
    nodes: LegacyWorkbenchNodeV1[];
  };
}

/** Explicit metadata supplied when creating an Original Workbench seed-v1 export. */
export interface LegacyWorkbenchSeedV1ExportOptions {
  /** Defaults to the preserved Original Workbench release identity. */
  prototypeVersion?: string;
  /** Omitted by default so otherwise identical exports remain deterministic. */
  exportedAt?: string;
}

function legacyField(value: unknown, path: string): LegacyWorkbenchFieldV1 {
  const code = "PACKAGE_LEGACY_INVALID" as const;
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    [
      "id",
      "category",
      "label",
      "options",
      "mustBeCorrect",
      "valueType",
      "validationRows"
    ],
    [
      "value",
      "richHtml",
      "originalRichHtml",
      "acceptableHint",
      "atlasId",
      "unit"
    ],
    path,
    code
  );
  const field: LegacyWorkbenchFieldV1 = {
    id: identifier(source.id, `${path}.id`, code),
    category: enumValue(
      source.category,
      WORKBENCH_FIELD_CATEGORIES,
      `${path}.category`,
      code
    ),
    label: label(source.label, `${path}.label`, undefined, code),
    options: stringArray(source.options, `${path}.options`, code),
    mustBeCorrect: booleanValue(
      source.mustBeCorrect,
      `${path}.mustBeCorrect`,
      code
    ),
    valueType: enumValue(
      source.valueType,
      WORKBENCH_VALUE_TYPES,
      `${path}.valueType`,
      code
    ),
    validationRows: validationRows(
      source.validationRows,
      `${path}.validationRows`,
      code
    )
  };
  if (source.value !== undefined)
    field.value = cloneDcmsValue(
      source.value,
      `${path}.value`,
      { nodes: 0, characters: 0 },
      0,
      code
    );
  for (const property of [
    "richHtml",
    "originalRichHtml",
    "acceptableHint",
    "atlasId",
    "unit"
  ] as const) {
    if (source[property] !== undefined) {
      field[property] = label(
        source[property],
        `${path}.${property}`,
        property === "atlasId" || property === "unit"
          ? MAX_LEGACY_FIELD_METADATA_LENGTH
          : DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
        code
      );
    }
  }
  return field;
}

function legacyNode(value: unknown, path: string): LegacyWorkbenchNodeV1 {
  const code = "PACKAGE_LEGACY_INVALID" as const;
  const source = requireObject(value, path, code);
  exactKeys(
    source,
    [
      "nodeId",
      "title",
      "scenario",
      "seed",
      "section",
      "step",
      "docDescription",
      "recordDescription",
      "uiFields",
      "definition",
      "recordValues",
      "originalRecordValues"
    ],
    [],
    path,
    code
  );
  const fieldsSource = arrayValue(
    source.uiFields,
    `${path}.uiFields`,
    DEFINITION_LIMITS.maxFields,
    0,
    code
  );
  const seen = new Set<string>();
  const uiFields = fieldsSource.map((item, index) => {
    const field = legacyField(item, `${path}.uiFields[${index}]`);
    duplicate(seen, field.id, `${path}.uiFields[${index}].id`, "field", code);
    return field;
  });
  const definition = formDefinition(
    source.definition,
    `${path}.definition`,
    code
  );
  const expected = fieldIdsAgree(
    {
      schemaVersion: 1,
      formId: definition.formId,
      formVersion: definition.version,
      fields: uiFields.map((field) => ({
        id: field.id,
        category: field.category,
        label: field.label,
        options: [...field.options],
        mustBeCorrect: field.mustBeCorrect,
        valueType: field.valueType,
        validationRows: field.validationRows.map(normalizedValidationRow),
        ...(field.richHtml === undefined ? {} : { richHtml: field.richHtml }),
        ...(field.originalRichHtml === undefined
          ? {}
          : { originalRichHtml: field.originalRichHtml }),
        ...(field.acceptableHint === undefined
          ? {}
          : { acceptableHint: field.acceptableHint }),
        ...(field.atlasId === undefined ? {} : { atlasId: field.atlasId }),
        ...(field.unit === undefined ? {} : { unit: field.unit })
      }))
    },
    definition,
    path,
    code
  );
  const recordValues = valueMap(
    source.recordValues,
    `${path}.recordValues`,
    code
  );
  const originalRecordValues = valueMap(
    source.originalRecordValues,
    `${path}.originalRecordValues`,
    code
  );
  exactValueKeys(recordValues, expected, `${path}.recordValues`);
  exactValueKeys(
    originalRecordValues,
    expected,
    `${path}.originalRecordValues`
  );
  return {
    nodeId: identifier(source.nodeId, `${path}.nodeId`, code),
    title: label(source.title, `${path}.title`, undefined, code),
    scenario: identifier(source.scenario, `${path}.scenario`, code),
    seed: stringValue(source.seed, `${path}.seed`, MAX_SEED_LENGTH, {}, code),
    section: integer(source.section, `${path}.section`, 1, code),
    step: integer(source.step, `${path}.step`, 1, code),
    docDescription: label(
      source.docDescription,
      `${path}.docDescription`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    ),
    recordDescription: label(
      source.recordDescription,
      `${path}.recordDescription`,
      DCMS_WORKBENCH_DESCRIPTION_MAX_CHARACTERS,
      code
    ),
    uiFields,
    definition,
    recordValues,
    originalRecordValues
  };
}

function legacyWorkbenchSeedV1Object(value: unknown): LegacyWorkbenchSeedV1 {
  const code = "PACKAGE_LEGACY_INVALID" as const;
  assertPlainJsonGraph(value);
  const source = requireObject(value, "$", code);
  exactKeys(
    source,
    ["schema", "schemaVersion", "revision"],
    ["prototypeVersion", "exportedAt"],
    "$",
    code
  );
  if (source.schema !== "dcms-form-validation-seed") {
    fail(
      code,
      "$.schema",
      "$.schema must be dcms-form-validation-seed for the legacy compatibility reader."
    );
  }
  if (source.schemaVersion !== 1) {
    fail(code, "$.schemaVersion", "$.schemaVersion must be 1.");
  }
  const revisionSource = requireObject(source.revision, "$.revision", code);
  exactKeys(
    revisionSource,
    ["productId", "revisionId", "revisionLabel", "documentId", "seed", "nodes"],
    ["profile"],
    "$.revision",
    code
  );
  const nodesSource = arrayValue(
    revisionSource.nodes,
    "$.revision.nodes",
    DCMS_WORKBENCH_COMPLETE_REVISION_MAX_FORMS,
    1,
    code
  );
  const seen = new Set<string>();
  const nodes = nodesSource.map((item, index) => {
    const node = legacyNode(item, `$.revision.nodes[${index}]`);
    duplicate(
      seen,
      node.nodeId,
      `$.revision.nodes[${index}].nodeId`,
      "node",
      code
    );
    return node;
  });
  return {
    schema: "dcms-form-validation-seed",
    schemaVersion: 1,
    ...(source.prototypeVersion === undefined
      ? {}
      : {
          prototypeVersion: label(
            source.prototypeVersion,
            "$.prototypeVersion",
            256,
            code
          )
        }),
    ...(source.exportedAt === undefined
      ? {}
      : {
          exportedAt: label(source.exportedAt, "$.exportedAt", 256, code)
        }),
    revision: {
      productId: identifier(
        revisionSource.productId,
        "$.revision.productId",
        code
      ),
      revisionId: identifier(
        revisionSource.revisionId,
        "$.revision.revisionId",
        code
      ),
      revisionLabel: label(
        revisionSource.revisionLabel,
        "$.revision.revisionLabel",
        undefined,
        code
      ),
      documentId: identifier(
        revisionSource.documentId,
        "$.revision.documentId",
        code
      ),
      seed: stringValue(
        revisionSource.seed,
        "$.revision.seed",
        MAX_SEED_LENGTH,
        {},
        code
      ),
      profile:
        revisionSource.profile === undefined
          ? "imported"
          : identifier(revisionSource.profile, "$.revision.profile", code),
      nodes
    }
  };
}

/** Parse the preserved HTML Workbench seed-v1 shape through a named boundary. */
export function parseLegacyWorkbenchSeedV1(
  text: string
): LegacyWorkbenchSeedV1 {
  return legacyWorkbenchSeedV1Object(parseJsonText(text, true));
}

/**
 * Convert a strictly parsed legacy seed into the current portable full-Revision
 * structure. Preparation/compilation remains a later acceptance boundary.
 */
export function convertLegacyWorkbenchSeedV1ToCompleteRevisionV2(
  legacy: LegacyWorkbenchSeedV1
): DcmsCompleteRevisionPackageV2 {
  const source = legacyWorkbenchSeedV1Object(legacy);
  const candidate: DcmsCompleteRevisionPackageV2 = {
    kind: DCMS_WORKBENCH_PACKAGE_KIND,
    schemaVersion: DCMS_WORKBENCH_PACKAGE_SCHEMA_VERSION,
    scope: "complete-revision",
    revision: {
      productId: source.revision.productId,
      revisionId: source.revision.revisionId,
      revisionLabel: source.revision.revisionLabel,
      documentId: source.revision.documentId,
      seed: source.revision.seed,
      profile: source.revision.profile
    },
    activeNodeId: source.revision.nodes[0].nodeId,
    forms: source.revision.nodes.map((node) => ({
      nodeId: node.nodeId,
      title: node.title,
      scenario: node.scenario,
      seed: node.seed,
      section: node.section,
      step: node.step,
      docDescription: node.docDescription,
      recordDescription: node.recordDescription,
      model: {
        schemaVersion: 1,
        formId: node.definition.formId,
        formVersion: node.definition.version,
        fields: node.uiFields.map((field) => ({
          id: field.id,
          category: field.category,
          label: field.label,
          options: [...field.options],
          mustBeCorrect: field.mustBeCorrect,
          valueType: field.valueType,
          validationRows: field.validationRows.map(normalizedValidationRow),
          ...(field.richHtml === undefined ? {} : { richHtml: field.richHtml }),
          ...(field.originalRichHtml === undefined
            ? {}
            : { originalRichHtml: field.originalRichHtml }),
          ...(field.acceptableHint === undefined
            ? {}
            : { acceptableHint: field.acceptableHint }),
          ...(field.atlasId === undefined ? {} : { atlasId: field.atlasId }),
          ...(field.unit === undefined ? {} : { unit: field.unit })
        }))
      },
      definition: normalizedDefinition(node.definition),
      currentValues: sortedValueMap(node.recordValues),
      originalValues: sortedValueMap(node.originalRecordValues)
    }))
  };
  return completeRevisionObject(candidate);
}

function normalizedLegacyWorkbenchFieldV1(
  field: LegacyWorkbenchFieldV1
): LegacyWorkbenchFieldV1 {
  return {
    id: field.id,
    category: field.category,
    label: field.label,
    options: [...field.options],
    mustBeCorrect: field.mustBeCorrect,
    valueType: field.valueType,
    validationRows: field.validationRows.map(normalizedValidationRow),
    ...(field.value === undefined
      ? {}
      : {
          value: cloneDcmsValue(field.value, `legacy.${field.id}.value`, {
            nodes: 0,
            characters: 0
          })
        }),
    ...(field.richHtml === undefined ? {} : { richHtml: field.richHtml }),
    ...(field.originalRichHtml === undefined
      ? {}
      : { originalRichHtml: field.originalRichHtml }),
    ...(field.acceptableHint === undefined
      ? {}
      : { acceptableHint: field.acceptableHint }),
    ...(field.atlasId === undefined ? {} : { atlasId: field.atlasId }),
    ...(field.unit === undefined ? {} : { unit: field.unit })
  };
}

function normalizedLegacyWorkbenchSeedV1(
  value: LegacyWorkbenchSeedV1
): LegacyWorkbenchSeedV1 {
  return {
    schema: "dcms-form-validation-seed",
    schemaVersion: 1,
    ...(value.prototypeVersion === undefined
      ? {}
      : { prototypeVersion: value.prototypeVersion }),
    ...(value.exportedAt === undefined ? {} : { exportedAt: value.exportedAt }),
    revision: {
      productId: value.revision.productId,
      revisionId: value.revision.revisionId,
      revisionLabel: value.revision.revisionLabel,
      documentId: value.revision.documentId,
      seed: value.revision.seed,
      profile: value.revision.profile,
      nodes: value.revision.nodes.map((node) => ({
        nodeId: node.nodeId,
        title: node.title,
        scenario: node.scenario,
        seed: node.seed,
        section: node.section,
        step: node.step,
        docDescription: node.docDescription,
        recordDescription: node.recordDescription,
        uiFields: node.uiFields.map(normalizedLegacyWorkbenchFieldV1),
        definition: normalizedDefinition(node.definition),
        recordValues: sortedValueMap(node.recordValues),
        originalRecordValues: sortedValueMap(node.originalRecordValues)
      }))
    }
  };
}

/** Validate, detach, normalize, and deterministically serialize seed-v1 JSON. */
export function serializeLegacyWorkbenchSeedV1(value: unknown): string {
  const parsed = legacyWorkbenchSeedV1Object(value);
  const text = `${JSON.stringify(normalizedLegacyWorkbenchSeedV1(parsed), null, 2)}\n`;
  enforceTextSize(text, "$serialized");
  return text;
}

/** Convert the current complete-Revision package into the Original Workbench seed-v1 shape. */
export function convertCompleteRevisionV2ToLegacyWorkbenchSeedV1(
  value: unknown,
  options: LegacyWorkbenchSeedV1ExportOptions = {}
): LegacyWorkbenchSeedV1 {
  const source = completeRevisionObject(value);
  const prototypeVersion = label(
    options.prototypeVersion ?? "0.10.5",
    "$.prototypeVersion",
    256,
    "PACKAGE_LEGACY_INVALID"
  );
  const exportedAt =
    options.exportedAt === undefined
      ? undefined
      : label(
          options.exportedAt,
          "$.exportedAt",
          256,
          "PACKAGE_LEGACY_INVALID"
        );
  const candidate: LegacyWorkbenchSeedV1 = {
    schema: "dcms-form-validation-seed",
    schemaVersion: 1,
    prototypeVersion,
    ...(exportedAt === undefined ? {} : { exportedAt }),
    revision: {
      productId: source.revision.productId,
      revisionId: source.revision.revisionId,
      revisionLabel: source.revision.revisionLabel,
      documentId: source.revision.documentId,
      seed: source.revision.seed,
      profile: source.revision.profile,
      nodes: source.forms.map((form) => ({
        nodeId: form.nodeId,
        title: form.title,
        scenario: form.scenario,
        seed: form.seed,
        section: form.section,
        step: form.step,
        docDescription: form.docDescription,
        recordDescription: form.recordDescription,
        uiFields: form.model.fields.map((field) => ({
          id: field.id,
          category: field.category,
          label: field.label,
          options: [...field.options],
          mustBeCorrect: field.mustBeCorrect,
          valueType: field.valueType,
          validationRows: field.validationRows.map(normalizedValidationRow),
          value: cloneDcmsValue(
            form.originalValues[field.id],
            `$.forms.${form.nodeId}.originalValues.${field.id}`,
            { nodes: 0, characters: 0 }
          ),
          ...(field.richHtml === undefined ? {} : { richHtml: field.richHtml }),
          ...(field.originalRichHtml === undefined
            ? {}
            : { originalRichHtml: field.originalRichHtml }),
          ...(field.acceptableHint === undefined
            ? {}
            : { acceptableHint: field.acceptableHint }),
          ...(field.atlasId === undefined ? {} : { atlasId: field.atlasId }),
          ...(field.unit === undefined ? {} : { unit: field.unit })
        })),
        definition: normalizedDefinition(form.definition),
        recordValues: sortedValueMap(form.currentValues),
        originalRecordValues: sortedValueMap(form.originalValues)
      }))
    }
  };
  return legacyWorkbenchSeedV1Object(candidate);
}
