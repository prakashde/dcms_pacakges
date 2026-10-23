/** Enter Fahrenheit; check a Celsius limit without replacing the original input. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField([
  {
    id: "maximum",
    expression: "ROUND((VALUE-32)*5/9,1)",
    criteria: "number_less_than",
    keyword: 105
  }
]);
for (const [input, celsius, allowed] of [
  [212, 100, true],
  [221, 105, false],
  [230, 110, false]
]) {
  const { result, field } = evaluate(definition, input);
  assert.equal(field.enteredValue, input);
  assert.equal(field.validationRowResults[0].calculatedValue, celsius);
  assert.equal(field.validationPassed, allowed);
  assert.equal(result.canSubmit, allowed);
  assert.equal(result.canSave, true);
}
