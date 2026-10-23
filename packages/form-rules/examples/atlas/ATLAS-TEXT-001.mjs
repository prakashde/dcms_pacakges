/** Normalize only the row value; Required Keywords still performs a substring test. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField(
  [
    {
      id: "lot",
      expression: "UPPER(TRIM(VALUE))",
      criteria: "required_keywords",
      keyword: "LOT-123",
      caseSensitive: true
    }
  ],
  true,
  "string"
);
const { result, field } = evaluate(definition, " lot-123 ");
assert.equal(field.enteredValue, " lot-123 ");
assert.equal(field.validationRowResults[0].calculatedValue, "LOT-123");
assert.equal(result.canSubmit, true);
assert.equal(evaluate(definition, "lot-999").result.canSubmit, false);
// Exact identity would need equality; a substring rule intentionally accepts this too.
assert.equal(
  evaluate(definition, "PREFIX-LOT-123-SUFFIX").result.canSubmit,
  true
);
