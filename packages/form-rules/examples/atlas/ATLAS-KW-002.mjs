/** Keyword operators have explicit precedence; the text match is case-insensitive here. */
import assert from "node:assert/strict";
import { parseKeywordExpression, evaluateKeyword } from "@dcms/form-rules";
const ast = parseKeywordExpression(
  "GROUND AND (STUD OR STRAP) AND NOT MISSING"
);
for (const [text, allowed] of [
  ["Ground stud installed", true],
  ["Ground strap installed", true],
  ["Ground strap missing", false],
  ["Stud installed", false]
]) {
  assert.equal(evaluateKeyword(ast, text, false), allowed);
}
// Punctuation is literal: the hyphen prevents OR-HOLD from being the OR operator.
const literal = parseKeywordExpression("OR-HOLD");
assert.equal(evaluateKeyword(literal, "Status OR-HOLD", true), true);
assert.equal(evaluateKeyword(literal, "Status HOLD", true), false);
