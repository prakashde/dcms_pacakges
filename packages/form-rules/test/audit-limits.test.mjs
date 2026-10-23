/** Inclusive resource ceilings: positive controls at the limit and negative controls one unit above it. */
import test from "node:test";
import assert from "node:assert/strict";
import * as e from "../dist/esm/index.js";
import { assertDcmsValue, assertFormShape } from "../dist/esm/boundaries.js";
const code = (fn, value) =>
  assert.throws(fn, (x) => x instanceof e.DcmsRuleError && x.code === value);
const field = (id = "x", rows = []) => ({
  id,
  label: "Value",
  valueType: "number",
  validationRows: rows
});
const form = (fields) => ({ formId: "limit-audit", version: 1, fields });
const rows = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: "r" + i,
    criteria: "number_less_than",
    keyword: 10
  }));
test("L01 formula source and parenthesis limits accept the boundary and reject the next unit", () => {
  for (const n of [8191, 8192])
    assert.equal(
      e.evaluateFormula("1" + " ".repeat(n - 1), { value: null }),
      1
    );
  code(
    () => e.prepareFormula("1" + " ".repeat(8192)),
    "FORMULA_LIMIT_EXCEEDED"
  );
  for (const n of [63, 64])
    assert.equal(
      e.evaluateFormula("(".repeat(n) + "1" + ")".repeat(n), { value: null }),
      1
    );
  code(
    () => e.prepareFormula("(".repeat(65) + "1" + ")".repeat(65)),
    "FORMULA_LIMIT_EXCEEDED"
  );
});
test("L02 function argument and keyword nesting ceilings are inclusive", () => {
  for (const n of [254, 255])
    assert.equal(
      e.evaluateFormula(`SUM(${Array(n).fill(1).join(",")})`, { value: null }),
      n
    );
  code(
    () => e.prepareFormula(`SUM(${Array(256).fill(1).join(",")})`),
    "FORMULA_LIMIT_EXCEEDED"
  );
  for (const n of [31, 32])
    assert.equal(
      e.evaluateKeyword(
        e.parseKeywordExpression("(".repeat(n) + "OK" + ")".repeat(n)),
        "OK",
        true
      ),
      true
    );
  code(
    () => e.parseKeywordExpression("(".repeat(33) + "OK" + ")".repeat(33)),
    "KEYWORD_LIMIT_EXCEEDED"
  );
});
test("L03 Form field, per-field row, ID and label boundaries compile at their maximum", () => {
  assert.doesNotThrow(() =>
    assert.equal(
      e.compileForm(
        form(Array.from({ length: 5000 }, (_, i) => field("x" + i)))
      ).fields.size,
      5000
    )
  );
  code(
    () =>
      e.compileForm(
        form(Array.from({ length: 5001 }, (_, i) => field("x" + i)))
      ),
    "DEFINITION_INVALID"
  );
  assert.equal(
    e.compileForm(form([field("x", rows(256))])).fields.get("x").validationRows
      .length,
    256
  );
  code(
    () => e.compileForm(form([field("x", rows(257))])),
    "DEFINITION_INVALID"
  );
  for (const [prop, max] of [
    ["id", 256],
    ["label", 4096]
  ]) {
    const f = field();
    f[prop] = "a".repeat(max);
    assert.doesNotThrow(() => e.compileForm(form([f])));
    f[prop] += "a";
    code(() => e.compileForm(form([f])), "DEFINITION_INVALID");
  }
});
test("L04 total-row structural guard accepts exactly 50000 and rejects 50001", () => {
  // Test the aggregate guard directly to isolate it from parser/compile cost and per-field limits.
  const fields = Array.from({ length: 195 }, (_, i) =>
    field("x" + i, rows(256))
  );
  fields.push(field("tail", rows(80)));
  assert.doesNotThrow(() => assertFormShape(form(fields)));
  fields.at(-1).validationRows.push({
    id: "r80",
    criteria: "number_less_than",
    keyword: 10
  });
  code(() => assertFormShape(form(fields)), "DEFINITION_INVALID");
});
test("L05 Revision node ceiling is inclusive and empty revisions are rejected", () => {
  const d = {
    revisionId: "r",
    version: 1,
    formElements: Array.from({ length: 100 }, (_, i) => ({
      nodeId: "n" + i,
      form: form([])
    }))
  };
  assert.equal(e.compileRevision(d).formElements.size, 100);
  d.formElements.push({ nodeId: "n100", form: form([]) });
  code(() => e.compileRevision(d), "REVISION_DEFINITION_INVALID");
  d.formElements = [];
  code(() => e.compileRevision(d), "REVISION_DEFINITION_INVALID");
});
test("L06 input and output character budgets count aggregate data and allow their exact ceiling", () => {
  for (const [output, max] of [
    [false, 8 * 1024 * 1024],
    [true, 1024 * 1024]
  ]) {
    const half = "x".repeat(max / 2);
    assert.doesNotThrow(() =>
      assertDcmsValue([half, half], "value", undefined, output)
    );
    code(
      () => assertDcmsValue([half, half, "x"], "value", undefined, output),
      "FORMULA_LIMIT_EXCEEDED"
    );
  }
});
test("L07 nested arrays and node counts include their container and reject one above the ceiling", () => {
  const nested = (n) => {
    let x = 1;
    for (let i = 0; i < n; i++) x = [x];
    return x;
  };
  assert.doesNotThrow(() => assertDcmsValue(nested(32)));
  code(() => assertDcmsValue(nested(33)), "FORMULA_LIMIT_EXCEEDED");
  for (const [output, max] of [
    [false, 100000],
    [true, 10000]
  ]) {
    assert.doesNotThrow(() =>
      assertDcmsValue(Array(max - 1).fill(null), "value", undefined, output)
    );
    code(
      () => assertDcmsValue(Array(max).fill(null), "value", undefined, output),
      "FORMULA_LIMIT_EXCEEDED"
    );
  }
});
test("L08 selection-value count accepts 10000 distinct values and rejects 10001", () => {
  const values = Array.from({ length: 10000 }, (_, i) => "choice" + i);
  const f = field("x", [
    { id: "r", criteria: "selection_values_include_any", keyword: values }
  ]);
  assert.doesNotThrow(() => e.compileForm(form([f])));
  values.push("extra");
  code(() => e.compileForm(form([f])), "DEFINITION_INVALID");
});
