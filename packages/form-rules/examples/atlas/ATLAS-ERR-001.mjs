/** An unavailable calculation blocks Submit even when ordinary rule failure would only warn. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
for (const [expression, code] of [
  ["1/VALUE", "FORMULA_DIV_ZERO"],
  ['FIELD("missing")', "FORMULA_UNRESOLVED_REFERENCE"]
]) {
  const definition = makeField(
    [
      { id: "calculation", expression, criteria: "number_equal_to", keyword: 0 }
    ],
    false
  );
  const { result, field } = evaluate(definition, 0);
  assert.equal(field.evaluationState, "error");
  assert.equal(field.validationState, null);
  assert.ok(field.evaluationErrorDetails.some((e) => e.code === code));
  assert.equal(result.canSubmit, false);
}
const handled = makeField(
  [
    {
      id: "calculation",
      expression: "IF(VALUE=0, 0, 1/VALUE)",
      criteria: "number_equal_to",
      keyword: 0
    }
  ],
  false
);
const { result, field } = evaluate(handled, 0);
assert.equal(field.validationRowResults[0].calculatedValue, 0);
assert.equal(field.evaluationState, "ok");
assert.equal(result.canSubmit, true);
