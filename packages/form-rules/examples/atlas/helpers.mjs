/** Small shared fixture: each case still states its own rules and independent expected outcomes. */
import { compileForm, evaluateRecord } from "@dcms/form-rules";
export function makeField(rows, mustBeCorrect = true, valueType = "number") {
  return {
    id: "value",
    label: "Example value",
    valueType,
    mustBeCorrect,
    validationRows: rows
  };
}
export function evaluate(field, value) {
  const plan = compileForm({ formId: "atlas", version: 1, fields: [field] });
  const result = evaluateRecord(plan, new Map([[field.id, value]]));
  return { result, field: result.values.get(field.id) };
}
