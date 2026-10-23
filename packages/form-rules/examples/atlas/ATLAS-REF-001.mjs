/** One source edit also rechecks its dependent; an unrelated result remains reusable. */
import assert from "node:assert/strict";
import {
  compileForm,
  evaluateRecord,
  evaluateChangeDetailed
} from "@dcms/form-rules";
const plan = compileForm({
  formId: "pressure",
  version: 1,
  fields: [
    {
      id: "limit",
      label: "Pressure limit",
      valueType: "number",
      mustBeCorrect: true,
      validationRows: []
    },
    {
      id: "measured",
      label: "Measured pressure",
      valueType: "number",
      mustBeCorrect: true,
      validationRows: [
        {
          id: "maximum",
          expression: 'VALUE-FIELD("limit")',
          criteria: "number_less_than",
          keyword: 0
        }
      ]
    },
    {
      id: "note",
      label: "Note",
      valueType: "string",
      mustBeCorrect: false,
      validationRows: []
    }
  ]
});
const values = new Map([
  ["limit", 100],
  ["measured", 95],
  ["note", "Checked"]
]);
const first = evaluateRecord(plan, values);
assert.equal(first.canSubmit, true);
values.set("limit", 90);
const change = evaluateChangeDetailed(plan, values, first, "limit");
assert.deepEqual([...change.affectedFieldIds].sort(), ["limit", "measured"]);
assert.equal(change.evaluation.canSubmit, false);
assert.equal(change.evaluation.values.get("measured").enteredValue, 95);
assert.equal(change.evaluation.values.get("note"), first.values.get("note"));
