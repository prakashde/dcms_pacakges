import test from "node:test";
import assert from "node:assert/strict";
import * as e from "../dist/esm/index.js";
const randomFrom = (seed) => () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const serialized = (r) =>
  JSON.parse(JSON.stringify(e.serializeRecordEvaluation(r)));
test("P01 4096 complete row evaluations match native Boolean precedence including ignored first operators", () => {
  const operators = ["AND", "OR", "AND NOT", "OR NOT"],
    native = { "AND": "&&", "OR": "||", "AND NOT": "&& !", "OR NOT": "|| !" };
  let cases = 0;
  for (const first of operators)
    for (const b of operators)
      for (const c of operators)
        for (const d of operators) {
          const ops = [first, b, c, d];
          // Only fixed operator tokens enter this test-only function. JavaScript's Boolean evaluator is the independent oracle.
          const expected = new Function(
            "a",
            "b",
            "c",
            "d",
            `return a ${native[b]} b ${native[c]} c ${native[d]} d;`
          );
          const fields = Array.from({ length: 4 }, (_, i) => ({
            id: `b${i}`,
            label: `Input ${i}`,
            valueType: "boolean"
          }));
          fields.push({
            id: "result",
            label: "Result",
            valueType: "number",
            mustBeCorrect: true,
            validationRows: ops.map((operator, i) => ({
              id: `r${i}`,
              operator,
              expression: `IF(FIELD("b${i}"),1,0)`,
              criteria: "number_equal_to",
              keyword: 1
            }))
          });
          const p = e.compileForm({ formId: "precedence", version: 1, fields });
          for (let bits = 0; bits < 16; bits++) {
            const values = Array.from(
                { length: 4 },
                (_, i) => !!(bits & (1 << i))
              ),
              entered = new Map(values.map((v, i) => [`b${i}`, v]));
            entered.set("result", 0);
            const r = e.evaluateRecord(p, entered);
            assert.equal(
              r.values.get("result").validationPassed,
              expected(...values),
              `${ops}: ${bits}`
            );
            assert.equal(r.canSubmit, expected(...values));
            cases++;
          }
        }
  assert.equal(cases, 4096);
});
test("P02 2000 seeded multi-edit steps equal full authoritative evaluation", () => {
  const rand = randomFrom(0xdca510);
  const fields = Array.from({ length: 24 }, (_, i) => ({
    id: `f${i}`,
    label: `Field ${i}`,
    valueType: "number",
    mustBeCorrect: i % 3 !== 0,
    validationRows: [
      {
        id: "lo",
        criteria: "number_greater_than",
        keyword: -2,
        expression: i ? `VALUE - FIELD("f${Math.floor((i - 1) / 2)}")` : "VALUE"
      },
      { id: "hi", operator: "OR", criteria: "number_less_than", keyword: 10 }
    ]
  }));
  const plan = e.compileForm({ formId: "property", version: 1, fields });
  const values = new Map(fields.map((f) => [f.id, 0]));
  let prev = e.evaluateRecord(plan, values);
  for (let step = 0; step < 2000; step++) {
    let id;
    for (let n = 0; n < 1 + (step % 3); n++) {
      id = `f${Math.floor(rand() * fields.length)}`;
      values.set(id, Math.round(rand() * 40) - 20);
    }
    prev = e.evaluateChange(plan, values, prev, id);
    assert.deepEqual(
      serialized(prev),
      serialized(e.evaluateRecord(plan, values)),
      `step ${step}`
    );
  }
});
test("P03 500 seeded parser inputs return a result or controlled error", () => {
  const rand = randomFrom(0xdca511);
  const tokens = [
    "VALUE",
    "1",
    "2",
    "+",
    "-",
    "^",
    "/",
    "&",
    "(",
    ")",
    ",",
    "IF",
    "AND",
    "OR",
    "NOT",
    '"A"',
    "1e309",
    "FIELD",
    "!",
    ";"
  ];
  for (let n = 0; n < 500; n++) {
    const input = Array.from(
      { length: 1 + Math.floor(rand() * 30) },
      () => tokens[Math.floor(rand() * tokens.length)]
    ).join(" ");
    try {
      e.prepareFormula(input);
    } catch (x) {
      assert.ok(x instanceof e.DcmsRuleError, `${input}: ${x}`);
    }
    try {
      e.parseKeywordExpression(input);
    } catch (x) {
      assert.ok(x instanceof e.DcmsRuleError, `${input}: ${x}`);
    }
  }
});

test("P04 generated valid and invalid formulas cannot pass through blanket parser rejection", () => {
  const rand = randomFrom(0xdca512);
  let accepted = 0,
    rejected = 0;
  for (let n = 0; n < 250; n++) {
    const a = Math.floor(rand() * 101),
      b = Math.floor(rand() * 101),
      c = 1 + Math.floor(rand() * 20),
      source = `(${a}+${b})*${c}`;
    assert.equal(
      e.evaluateFormula(source, { value: null }),
      (a + b) * c,
      source
    );
    accepted++;
    assert.throws(
      () => e.prepareFormula(source + ")"),
      (x) => x instanceof e.DcmsRuleError && x.code === "FORMULA_SYNTAX_ERROR"
    );
    rejected++;
  }
  assert.equal(accepted, 250);
  assert.equal(rejected, 250);
});
