/** Selection checks use set membership without sorting or deduplicating the source array. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField(
  [
    {
      id: "required",
      criteria: "selection_values_include_all",
      keyword: ["A", "B"]
    }
  ],
  true,
  "string"
);
for (const [selected, allowed] of [
  [["A", "B"], true],
  [["B", "A"], true],
  [["A", "B", "A"], true],
  [["A", "A"], false]
]) {
  const before = structuredClone(selected);
  const { result, field } = evaluate(definition, selected);
  assert.equal(result.canSubmit, allowed);
  assert.deepEqual(selected, before);
  assert.deepEqual(field.enteredValue, before);
}
