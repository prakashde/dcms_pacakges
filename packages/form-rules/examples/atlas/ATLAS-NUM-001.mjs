/** Strict comparisons make an open range: neither endpoint is accepted. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField([
  { id: "minimum", criteria: "number_greater_than", keyword: 18 },
  { id: "maximum", operator: "AND", criteria: "number_less_than", keyword: 22 }
]);
for (const [input, allowed] of [
  [20, true],
  [18, false],
  [22, false],
  [17.9, false],
  [null, false]
]) {
  const { result, field } = evaluate(definition, input);
  assert.equal(field.validationPassed, allowed);
  assert.equal(result.canSubmit, allowed);
  assert.equal(field.enteredValue, input);
}
