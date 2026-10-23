/** Adjacent literal terms insert OR and produce an advisory authoring warning. */
import assert from "node:assert/strict";
import {
  diagnoseKeywordExpression,
  parseKeywordExpression,
  evaluateKeyword
} from "@dcms/form-rules";
const diagnostic = diagnoseKeywordExpression("PASS ACCEPTABLE");
assert.equal(diagnostic.state, "valid");
assert.ok(diagnostic.warnings.some((w) => w.code === "KEYWORD_IMPLICIT_OR"));
const ast = parseKeywordExpression("PASS ACCEPTABLE");
for (const [text, allowed] of [
  ["Inspection result: PASS", true],
  ["Inspection result: ACCEPTABLE", true],
  ["HOLD pending review", false]
]) {
  assert.equal(evaluateKeyword(ast, text, false), allowed);
}
