/** Public APIs and lazy branches not exercised by the original high-level fixture tests. */
import test from "node:test";
import assert from "node:assert/strict";
import * as e from "../dist/esm/index.js";
const value = (source) => e.evaluateFormula(source, { value: null });
const throws = (source, code) =>
  assert.throws(
    () => value(source),
    (x) => x instanceof e.DcmsRuleError && x.code === code,
    source
  );
test("F01 IFS and SWITCH evaluate only the selected result and report unmatched cases", () => {
  for (const [source, expected] of [
    ["IFS(FALSE,1/0,TRUE,7,TRUE,1/0)", 7],
    ["SWITCH(2,1,1/0,2,7,1/0)", 7],
    ["SWITCH(3,1,1/0,2,1/0,9)", 9]
  ])
    assert.equal(value(source), expected);
  for (const source of ["IFS(FALSE,1)", "SWITCH(3,1,2)"])
    throws(source, "FORMULA_RUNTIME_ERROR");
  for (const source of ["IFS(TRUE)", "IFS(TRUE,1,FALSE)", "SWITCH(1,2)"])
    throws(source, "FORMULA_BAD_ARGUMENTS");
});
test("F02 CHOOSE, COALESCE and logical functions short-circuit and validate their arguments", () => {
  for (const [source, expected] of [
    ["CHOOSE(2,1/0,7,1/0)", 7],
    ['COALESCE(VALUE,"",0,1/0)', 0],
    ['COALESCE(VALUE,"")', null],
    ["AND(FALSE,1/0)", false],
    ["AND(TRUE,TRUE)", true],
    ["OR(TRUE,1/0)", true],
    ["OR(FALSE,FALSE)", false],
    ["NOT(TRUE)", false],
    ["IF(FALSE,1/0)", false]
  ])
    assert.equal(value(source), expected, source);
  for (const source of [
    "CHOOSE(0,1)",
    "CHOOSE(2,1)",
    "CHOOSE(1.5,1,2)",
    "CHOOSE(1)",
    "COALESCE()",
    "AND()",
    "OR()",
    "IF(TRUE)",
    "IF(TRUE,1,2,3)"
  ])
    throws(source, "FORMULA_BAD_ARGUMENTS");
  for (const source of ["NOT()", "NOT(TRUE,FALSE)"])
    throws(source, "FORMULA_SYNTAX_ERROR");
});
test("F03 public AST and historical program APIs preserve references, values and controlled errors", () => {
  const source = '-FIELD("stable") + IF(VALUE>0,other,0)',
    ast = e.parseFormula(source),
    refs = new Map([
      ["stable", 2],
      ["other", 9]
    ]);
  assert.deepEqual([...e.collectFormulaDependencies(ast)].sort(), [
    "other",
    "stable"
  ]);
  for (const input of [source, ast]) {
    const p = e.compileFormulaProgram(input);
    assert.equal(e.evaluateFormulaProgram(p, { value: 1, fields: refs }), 7);
    assert.equal(
      e.evaluateFormulaProgram(p, { value: 0, references: refs }),
      -2
    );
    assert.equal(e.evaluateFormula(input, { value: 1, references: refs }), 7);
  }
  assert.throws(
    () =>
      e.evaluateFormulaProgram(e.compileFormulaProgram('FIELD("missing")'), {
        value: null
      }),
    { code: "FORMULA_UNRESOLVED_REFERENCE" }
  );
});
test("F04 LRU access refreshes recency, replacement stays within capacity and clear removes entries", () => {
  const c = new e.LruCache(2);
  c.set("a", 1);
  c.set("b", 2);
  assert.equal(c.get("a"), 1);
  c.set("c", 3);
  assert.equal(c.get("b"), undefined);
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("c"), 3);
  assert.equal(c.size, 2);
  c.set("a", 10);
  c.set("d", 4);
  assert.equal(c.get("c"), undefined);
  assert.equal(c.get("a"), 10);
  assert.equal(c.get("d"), 4);
  assert.equal(c.size, 2);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get("a"), undefined);
});
test("F05 standalone validation rules preserve first-row and negation diagnostics", () => {
  const rules = e.compileValidationRules([
    { operator: "OR NOT", criteria: "number_greater_than", keyword: 0 },
    { operator: "AND NOT", criteria: "number_less_than", keyword: 10 }
  ]);
  assert.equal(rules[0].operator, "AND");
  const failing = e.runValidationRules(rules, 5);
  assert.equal(failing.passed, false);
  assert.match(failing.failures[0], /AND NOT/);
  assert.deepEqual(e.runValidationRules(rules, 15), {
    passed: true,
    failures: []
  });
  assert.deepEqual(e.runValidationRules([], null), {
    passed: true,
    failures: []
  });
});
test("F06 legacy calculated-field errors preserve structured detail without a fictitious row ID", () => {
  const p = e.compileForm({
    formId: "legacy-error",
    version: 1,
    fields: [
      { id: "x", label: "X", valueType: "number", expression: "1 / VALUE" }
    ]
  });
  const r = e.evaluateRecordPayload(p, {
    formId: "legacy-error",
    formVersion: 1,
    values: { x: 0 }
  });
  assert.equal(r.canSubmit, false);
  assert.equal(r.fields.x.evaluationState, "error");
  const d = JSON.parse(JSON.stringify(r)).fields.x.evaluationErrorDetails[0];
  assert.equal(d.code, "FORMULA_DIV_ZERO");
  assert.equal(Object.hasOwn(d, "rowId"), false);
  assert.match(d.message, /zero/);
});
