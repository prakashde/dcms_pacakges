/** Any and All express different requirements, especially when excluding combinations. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
const cases = [
  ["include_any", ["A"], true],
  ["include_any", ["C"], false],
  ["include_all", ["A", "B"], true],
  ["include_all", ["A"], false],
  ["exclude_any", ["C"], true],
  ["exclude_any", ["A", "C"], false],
  ["exclude_all", ["A"], true],
  ["exclude_all", ["A", "B"], false]
];
for (const [mode, selected, allowed] of cases) {
  const definition = makeField(
    [
      {
        id: "selection",
        criteria: "selection_values_" + mode,
        keyword: ["A", "B"]
      }
    ],
    true,
    "string"
  );
  assert.equal(evaluate(definition, selected).result.canSubmit, allowed, mode);
}
