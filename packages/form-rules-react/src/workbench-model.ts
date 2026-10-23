/** Lossless, explicit bridge between engine Form definitions and Workbench presentation metadata. */
import type {
  FieldDefinition,
  FormDefinition,
  ValidationRowDefinition
} from "@dcms/form-rules";
import type { WorkbenchFieldCategory } from "./contracts.js";

export interface WorkbenchFieldPresentation {
  id: string;
  category: WorkbenchFieldCategory;
  options?: readonly string[];
  richHtml?: string;
  originalRichHtml?: string;
  acceptableHint?: string;
  /** Original Workbench validation-Atlas trace identity. */
  atlasId?: string;
  /** Original Workbench display/fixture unit text. */
  unit?: string;
}

export interface WorkbenchFieldModel {
  id: string;
  category: WorkbenchFieldCategory;
  label: string;
  options: string[];
  mustBeCorrect: boolean;
  valueType: "number" | "string";
  validationRows: ValidationRowDefinition[];
  richHtml?: string;
  originalRichHtml?: string;
  acceptableHint?: string;
  /** Typed compatibility metadata retained for Original Workbench seed v1. */
  atlasId?: string;
  /** Typed compatibility metadata retained for Original Workbench seed v1. */
  unit?: string;
}

export interface WorkbenchFormModel {
  schemaVersion: 1;
  formId: string;
  formVersion: string | number;
  fields: WorkbenchFieldModel[];
}

function cloneValidationRow(
  row: ValidationRowDefinition
): ValidationRowDefinition {
  return {
    ...row,
    keyword: Array.isArray(row.keyword) ? [...row.keyword] : row.keyword
  };
}

export function valueTypeForWorkbenchCategory(
  category: WorkbenchFieldCategory
): "number" | "string" {
  return category === "Number" ? "number" : "string";
}

function assertPreferredFieldModel(field: FieldDefinition) {
  if (
    field.expression !== undefined ||
    field.validations !== undefined ||
    field.formulaValidations !== undefined
  ) {
    throw new Error(
      `Field ${field.id} uses a legacy definition shape that the Workbench model will not silently discard.`
    );
  }
  if (field.valueType === "boolean") {
    throw new Error(
      `Field ${field.id} uses boolean valueType, which has no current Workbench Field Category.`
    );
  }
}

/**
 * Combine an authoritative engine definition with explicit Workbench-only presentation metadata.
 * String fields are intentionally not guessed as Text/Radio/Checkbox/Rich Text.
 */
export function createWorkbenchFormModel(
  definition: FormDefinition,
  presentation: readonly WorkbenchFieldPresentation[]
): WorkbenchFormModel {
  const presentationById = new Map<string, WorkbenchFieldPresentation>();
  for (const item of presentation) {
    if (presentationById.has(item.id)) {
      throw new Error(`Duplicate Workbench presentation field ID: ${item.id}`);
    }
    presentationById.set(item.id, item);
  }

  if (presentationById.size !== definition.fields.length) {
    throw new Error(
      "Workbench presentation metadata must contain exactly one entry for every Form field."
    );
  }

  const fields = definition.fields.map((field) => {
    assertPreferredFieldModel(field);
    const view = presentationById.get(field.id);
    if (!view) {
      throw new Error(
        `Missing Workbench presentation metadata for field ${field.id}.`
      );
    }
    const expectedValueType = valueTypeForWorkbenchCategory(view.category);
    if (field.valueType !== expectedValueType) {
      throw new Error(
        `Field ${field.id} category ${view.category} requires valueType ${expectedValueType}, not ${field.valueType}.`
      );
    }
    if (
      field.inputUnit !== undefined &&
      view.unit !== undefined &&
      field.inputUnit !== view.unit
    ) {
      throw new Error(
        `Field ${field.id} inputUnit does not match its Workbench unit metadata.`
      );
    }
    const unit = view.unit ?? field.inputUnit;
    return {
      id: field.id,
      category: view.category,
      label: field.label,
      options: [...(view.options ?? [])],
      mustBeCorrect: !!field.mustBeCorrect,
      valueType: expectedValueType,
      validationRows: (field.validationRows ?? []).map(cloneValidationRow),
      ...(view.richHtml === undefined ? {} : { richHtml: view.richHtml }),
      ...(view.originalRichHtml === undefined
        ? {}
        : { originalRichHtml: view.originalRichHtml }),
      ...(view.acceptableHint === undefined
        ? {}
        : { acceptableHint: view.acceptableHint }),
      ...(view.atlasId === undefined ? {} : { atlasId: view.atlasId }),
      ...(unit === undefined ? {} : { unit })
    } satisfies WorkbenchFieldModel;
  });

  const extra = [...presentationById.keys()].filter(
    (id) => !definition.fields.some((field) => field.id === id)
  );
  if (extra.length) {
    throw new Error(
      `Workbench presentation contains unknown field IDs: ${extra.join(", ")}.`
    );
  }

  return {
    schemaVersion: 1,
    formId: definition.formId,
    formVersion: definition.version,
    fields
  };
}

/** Convert the Workbench model back to the preferred engine definition without comma-splitting options. */
export function formDefinitionFromWorkbenchModel(
  model: WorkbenchFormModel
): FormDefinition {
  if (model.schemaVersion !== 1) {
    throw new Error(
      `Unsupported Workbench model schemaVersion: ${model.schemaVersion}.`
    );
  }
  const ids = new Set<string>();
  const fields = model.fields.map((field) => {
    if (ids.has(field.id)) {
      throw new Error(`Duplicate Workbench field ID: ${field.id}`);
    }
    ids.add(field.id);
    const expectedValueType = valueTypeForWorkbenchCategory(field.category);
    if (field.valueType !== expectedValueType) {
      throw new Error(
        `Field ${field.id} category ${field.category} requires valueType ${expectedValueType}.`
      );
    }
    return {
      id: field.id,
      label: field.label,
      valueType: expectedValueType,
      ...(field.unit?.trim() ? { inputUnit: field.unit.trim() } : {}),
      mustBeCorrect: field.mustBeCorrect,
      validationRows: field.validationRows.map(cloneValidationRow)
    } satisfies FieldDefinition;
  });

  return {
    formId: model.formId,
    version: model.formVersion,
    fields
  };
}
