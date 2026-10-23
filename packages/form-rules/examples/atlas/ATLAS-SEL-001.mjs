/** A single selection must be included and must not be excluded. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField(
  [
    {
      id: "allowed",
      criteria: "selection_values_include",
      keyword: ["PASS", "ACCEPTABLE"]
    },
    {
      id: "excluded",
      operator: "AND",
      criteria: "selection_values_exclude",
      keyword: ["HOLD", "REJECT"]
    }
  ],
  true,
  "string"
);
for (const [value, allowed] of [
  ["PASS", true],
  ["ACCEPTABLE", true],
  ["HOLD", false],
  ["REJECT", false],
  ["OTHER", false]
]) {
  assert.equal(evaluate(definition, value).result.canSubmit, allowed);
}
