/** Pure Form-authoring transformations used by the React FormEditor. */
import type { ValidationRowDefinition } from "@dcms/form-rules";
import type { WorkbenchFieldCategory } from "./contracts.js";
import type {
  WorkbenchFieldModel,
  WorkbenchFormModel
} from "./workbench-model.js";
import {
  normalizeValidationRowsForCategory,
  cloneValidationRow
} from "./validation-editor.js";

export function cloneWorkbenchField(
  field: WorkbenchFieldModel
): WorkbenchFieldModel {
  return {
    ...field,
    options: [...field.options],
    validationRows: field.validationRows.map(cloneValidationRow)
  };
}

export function cloneWorkbenchFormModel(
  model: WorkbenchFormModel
): WorkbenchFormModel {
  return {
    ...model,
    fields: model.fields.map(cloneWorkbenchField)
  };
}

export function nextWorkbenchFieldId(
  fields: readonly WorkbenchFieldModel[]
): string {
  const existing = new Set(fields.map((field) => field.id));
  const baseNumber = fields.length + 1;
  let id = `field_${String(baseNumber).padStart(2, "0")}`;
  while (existing.has(id)) id += "_x";
  return id;
}

export function defaultWorkbenchField(
  fields: readonly WorkbenchFieldModel[]
): WorkbenchFieldModel {
  const id = nextWorkbenchFieldId(fields);
  const number = fields.length + 1;
  const validationRows: ValidationRowDefinition[] = [
    {
      id: `${id}_vr_01`,
      criteria: "character_limit_less_than",
      keyword: 100
    }
  ];
  return {
    id,
    category: "Text",
    label: `New Field ${number}`,
    options: [],
    mustBeCorrect: false,
    valueType: "string",
    validationRows
  };
}

export function applyWorkbenchFieldCategory(
  field: WorkbenchFieldModel,
  category: WorkbenchFieldCategory
): WorkbenchFieldModel {
  let options = field.options;
  if (category === "Checkbox" && options.length === 0) {
    options = ["Option A", "Option B", "Option C"];
  } else if (category === "Radio" && options.length === 0) {
    options = ["Pass", "Fail"];
  } else if (
    category === "Number" ||
    category === "Text" ||
    category === "Rich Text"
  ) {
    options = [];
  }

  return {
    ...cloneWorkbenchField(field),
    category,
    valueType: category === "Number" ? "number" : "string",
    unit: category === "Number" ? field.unit : undefined,
    options: [...options],
    validationRows: normalizeValidationRowsForCategory(
      field.validationRows,
      category
    )
  };
}

export function replaceWorkbenchField(
  model: WorkbenchFormModel,
  field: WorkbenchFieldModel
): WorkbenchFormModel {
  return {
    ...model,
    fields: model.fields.map((current) =>
      current.id === field.id ? cloneWorkbenchField(field) : current
    )
  };
}

export function reorderWorkbenchField(
  model: WorkbenchFormModel,
  fieldId: string,
  targetIndex: number
): WorkbenchFormModel {
  const sourceIndex = model.fields.findIndex((field) => field.id === fieldId);
  if (sourceIndex < 0) {
    throw new Error(`Unknown Workbench field ID: ${fieldId}`);
  }
  if (
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= model.fields.length
  ) {
    throw new Error(
      `Workbench field target index is out of range: ${targetIndex}`
    );
  }
  if (sourceIndex === targetIndex) return model;

  const fields = [...model.fields];
  const [field] = fields.splice(sourceIndex, 1);
  fields.splice(targetIndex, 0, field);
  return { ...model, fields };
}

export function addWorkbenchField(
  model: WorkbenchFormModel
): WorkbenchFormModel {
  return {
    ...model,
    fields: [...model.fields, defaultWorkbenchField(model.fields)]
  };
}

export function deleteWorkbenchField(
  model: WorkbenchFormModel,
  fieldId: string
): WorkbenchFormModel {
  if (model.fields.length <= 1) {
    throw new Error("The Workbench keeps at least one field.");
  }
  if (!model.fields.some((field) => field.id === fieldId)) {
    throw new Error(`Unknown Workbench field ID: ${fieldId}`);
  }
  return {
    ...model,
    fields: model.fields.filter((field) => field.id !== fieldId)
  };
}
