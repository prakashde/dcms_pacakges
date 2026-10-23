/** Exactly A+B assumes an application-enforced complete catalog of A, B, C, D. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const definition = makeField(
  [
    {
      id: "required",
      criteria: "selection_values_include_all",
      keyword: ["A", "B"]
    },
    {
      id: "other",
      operator: "AND",
      criteria: "selection_values_exclude_any",
      keyword: ["C", "D"]
    }
  ],
  true,
  "string"
);
for (const [selected, allowed] of [
  [["A", "B"], true],
  [["A"], false],
  [["A", "B", "C"], false],
  [["B", "D"], false]
]) {
  assert.equal(evaluate(definition, selected).result.canSubmit, allowed);
}
// The rules cannot infer an unknown option catalog: the host must reject E.
assert.equal(evaluate(definition, ["A", "B", "E"]).result.canSubmit, true);
