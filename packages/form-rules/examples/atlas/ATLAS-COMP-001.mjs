/** Every row sees the same source input; a later NOT negates that row's criterion. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField([
  { id: "minimum", criteria: "number_greater_than", keyword: 180 },
  {
    id: "converted",
    operator: "AND",
    expression: "(VALUE-32)*5/9",
    criteria: "number_less_than",
    keyword: 105
  },
  {
    id: "sentinel",
    operator: "AND NOT",
    criteria: "number_equal_to",
    keyword: 999
  }
]);
const { result, field } = evaluate(definition, 212);
assert.deepEqual(
  field.validationRowResults.map((r) => r.validationPassed),
  [true, true, false]
);
assert.deepEqual(
  field.validationRowResults.map((r) => r.calculatedValue),
  [212, 100, 212]
);
assert.equal(result.canSubmit, true);
assert.equal(evaluate(definition, 999).result.canSubmit, false);
