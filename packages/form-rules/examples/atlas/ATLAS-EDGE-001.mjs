/** All eight truth assignments independently specify A OR (B AND NOT C). */
import assert from "node:assert/strict";
import { combineValidationRowResults } from "@dcms/form-rules";
const rules = ["AND", "OR", "AND NOT"].map((operator) => ({
  operator,
  criteria: "number_equal_to",
  keyword: 1,
  caseSensitive: false
}));
const expected = [
  [false, false, false, false],
  [false, false, true, false],
  [false, true, false, true],
  [false, true, true, false],
  [true, false, false, true],
  [true, false, true, true],
  [true, true, false, true],
  [true, true, true, true]
];
for (const [a, b, c, allowed] of expected) {
  assert.equal(
    combineValidationRowResults(rules, [a, b, c]),
    allowed,
    `${a}, ${b}, ${c}`
  );
}
