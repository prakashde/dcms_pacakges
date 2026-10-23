/** Independent acceptance examples and adversarial boundaries; expectations come from the written contract. */
import test from "node:test";
import assert from "node:assert/strict";
import * as e from "../dist/esm/index.js";
const row = (criteria, keyword, extra = {}) => ({
  id: "r",
  criteria,
  keyword,
  ...extra
});
const field = (id = "x", extra = {}) => ({
  id,
  label: id,
  valueType: "number",
  mustBeCorrect: true,
  ...extra
});
const definition = (fields) => ({ formId: "audit", version: 1, fields });
const planFor = (criteria, keyword, extra = {}) =>
  e.compileForm(
    definition([
      field("x", { validationRows: [row(criteria, keyword, extra)] })
    ])
  );
const evaluate = (p, value) => e.evaluateRecord(p, new Map([["x", value]]));
const passed = (p, value) =>
  evaluate(p, value).values.get("x").validationPassed;
const throwsCode = (fn, code) =>
  assert.throws(fn, (x) => x instanceof e.DcmsRuleError && x.code === code);
const canonical = (x) => JSON.parse(JSON.stringify(x));

test("A01 FR-FN-24 numeric criteria discriminate below, equal and above boundaries", () => {
  const cases = [
    ["number_greater_than", [false, false, true]],
    ["number_less_than", [true, false, false]],
    ["number_equal_to", [false, true, false]]
  ];
  for (const [criteria, expected] of cases) {
    const p = planFor(criteria, 2);
    for (let i = 0; i < 3; i++)
      assert.equal(passed(p, i + 1), expected[i], `${criteria}: ${i + 1}`);
  }
  const p = planFor("number_equal_to", 2);
  for (const value of ["2", " 2 ", 2]) assert.equal(passed(p, value), true);
  for (const value of ["", " ", "two", "Infinity", true, false, null, [], [2]])
    assert.equal(passed(p, value), false, JSON.stringify(value));
});
test("A02 FR-FN-24 character limits are strict and count UTF-16 units without normalization", () => {
  for (const [criteria, expected] of [
    ["character_limit_less_than", [true, false, false]],
    ["character_limit_more_than", [false, false, true]],
    ["character_limit_equal_to", [false, true, false]]
  ]) {
    const p = planFor(criteria, 2);
    for (let i = 0; i < 3; i++)
      assert.equal(
        passed(p, "X".repeat(i + 1)),
        expected[i],
        `${criteria}: ${i + 1}`
      );
  }
  const two = planFor("character_limit_equal_to", 2);
  assert.equal(passed(two, "😀"), true);
  assert.equal(passed(two, "e\u0301"), true);
  assert.equal(passed(two, "é"), false);
  const empty = planFor("character_limit_equal_to", 0);
  assert.equal(passed(empty, ""), true);
  assert.equal(passed(empty, null), true);
});
test("A03 AC-VAL-STATE-01 every ordinary state has exact lists and Submit behavior", () => {
  for (const mustBeCorrect of [false, true])
    for (const value of [1, 3]) {
      const p = e.compileForm(
        definition([
          field("x", {
            mustBeCorrect,
            validationRows: [row("number_less_than", 2)]
          })
        ])
      );
      const r = evaluate(p, value),
        valid = value === 1,
        state = valid ? "valid" : mustBeCorrect ? "blocking" : "warning";
      assert.equal(r.values.get("x").validationState, state);
      assert.equal(r.values.get("x").evaluationState, "ok");
      assert.equal(r.canSubmit, valid || !mustBeCorrect);
      assert.equal(r.canSave, true);
      for (const [key, expected] of Object.entries({
        validFieldIds: valid ? ["x"] : [],
        warningFieldIds: state === "warning" ? ["x"] : [],
        blockingFieldIds: state === "blocking" ? ["x"] : [],
        invalidFieldIds: valid ? [] : ["x"],
        errorFieldIds: [],
        unvalidatedFieldIds: []
      }))
        assert.deepEqual(r[key], expected, key);
    }
  const empty = evaluate(e.compileForm(definition([field()])), null);
  assert.equal(empty.canSubmit, true);
  assert.deepEqual(empty.unvalidatedFieldIds, ["x"]);
  assert.equal(empty.values.get("x").hasValidation, false);
});
test("A04 AC-VAL-STATE-02 every row operator leaves runtime errors distinct and blocking", () => {
  for (const mustBeCorrect of [false, true])
    for (const operator of ["AND", "OR", "AND NOT", "OR NOT"])
      for (const errorFirst of [false, true]) {
        const boom = row("number_equal_to", 1, {
            id: "boom",
            expression: "=1 / VALUE"
          }),
          ok = row("number_equal_to", 0, { id: "ok" });
        const rows = errorFirst
          ? [boom, { ...ok, operator }]
          : [ok, { ...boom, operator }];
        const p = e.compileForm(
          definition([field("x", { mustBeCorrect, validationRows: rows })])
        );
        const r = evaluate(p, 0),
          x = r.values.get("x");
        assert.equal(x.evaluationState, "error");
        assert.equal(x.validationState, null);
        assert.equal(r.canSave, true);
        assert.equal(r.canSubmit, false);
        assert.deepEqual(r.errorFieldIds, ["x"]);
        assert.deepEqual(r.blockingFieldIds, ["x"]);
        assert.deepEqual(r.warningFieldIds, []);
        assert.equal(x.evaluationErrors.length, 1);
      }
});
test("A05 AC-VAL-STATE-02 serialized runtime errors preserve code, row and source position", () => {
  const p = planFor("number_equal_to", 1, {
      id: "missing-row",
      expression: '=1 + FIELD("missing")'
    }),
    r = e.serializeRecordEvaluation(evaluate(p, 0));
  assert.ok(
    Array.isArray(r.fields.x.evaluationErrorDetails),
    "Structured errors must survive the Form evaluation boundary"
  );
  const detail = canonical(r.fields.x.evaluationErrorDetails[0]);
  assert.equal(detail.code, "FORMULA_UNRESOLVED_REFERENCE");
  assert.equal(detail.category, "unresolved_reference");
  assert.equal(detail.rowId, "missing-row");
  assert.equal(detail.position, 5);
  assert.equal(detail.length, 16);
  assert.match(detail.message, /missing/);
  assert.deepEqual(canonical(r).fields.x.evaluationErrorDetails, [detail]);
});
test("A06 AC-VAL-OP-03 deletion and reordering recompute grouping without changing the old plan", () => {
  const a = row("number_greater_than", 10, { id: "a" }),
    b = row("number_less_than", 10, { id: "b", operator: "OR" }),
    c = row("number_equal_to", 5, { id: "c", operator: "AND NOT" });
  const d = definition([field("x", { validationRows: [a, b, c] })]),
    old = e.compileForm(d);
  assert.equal(evaluate(old, 5).canSubmit, false);
  d.fields[0].validationRows = [a, b];
  const deleted = e.compileForm(d);
  assert.deepEqual(
    deleted.fields.get("x").validationRows.map((r) => r.definition.id),
    ["a", "b"]
  );
  assert.equal(evaluate(deleted, 5).canSubmit, true);
  d.fields[0].validationRows = [a, c, b];
  assert.equal(evaluate(e.compileForm(d), 5).canSubmit, true);
  assert.equal(evaluate(old, 5).canSubmit, false);
  d.fields[0].validationRows = [];
  const none = evaluate(e.compileForm(d), null);
  assert.equal(none.values.get("x").validationState, "not_validated");
  assert.equal(none.canSubmit, true);
});
test("A07 AC-VAL-SEL-05 conflict detection does not reject satisfiable OR, NOT or case variants", () => {
  const inc = row("selection_values_include_all", ["Alpha"], { id: "inc" }),
    exc = row("selection_values_exclude_any", ["Alpha"], {
      id: "exc",
      operator: "OR"
    });
  for (const operator of ["OR", "AND NOT"]) {
    const p = e.compileForm(
      definition([field("x", { validationRows: [inc, { ...exc, operator }] })])
    );
    assert.equal(passed(p, ["Alpha"]), true);
  }
  const p = e.compileForm(
    definition([
      field("x", {
        validationRows: [
          { ...inc, keyword: ["alpha"], caseSensitive: false },
          { ...exc, operator: "AND", keyword: ["alpha"], caseSensitive: true }
        ]
      })
    ])
  );
  assert.equal(passed(p, ["ALPHA"]), true);
  const transformed = e.compileForm(
    definition([
      field("x", {
        validationRows: [
          row("number_greater_than", 10, { id: "a" }),
          row("number_less_than", 5, { id: "b", expression: "VALUE / 10" })
        ]
      })
    ])
  );
  assert.equal(passed(transformed, 20), true);
});
test("A08 FR-FN-23 and FR-FN-26 keyword precedence, phrase boundaries and case have negative controls", () => {
  const samples = [
    ["A OR B AND NOT C", (v) => v[0] || (v[1] && !v[2])],
    ["(A OR B) AND NOT C", (v) => (v[0] || v[1]) && !v[2]],
    ["A B AND C", (v) => v[0] || (v[1] && v[2])]
  ];
  for (const [source, expected] of samples) {
    const ast = e.parseKeywordExpression(source);
    for (let bits = 0; bits < 8; bits++) {
      const v = [0, 1, 2].map((i) => !!(bits & (1 << i))),
        text = ["A", "B", "C"].filter((_, i) => v[i]).join(" ");
      assert.equal(
        e.evaluateKeyword(ast, text, true),
        expected(v),
        `${source}: ${text}`
      );
    }
  }
  const phrase = e.parseKeywordExpression('"A.* B"');
  assert.equal(e.evaluateKeyword(phrase, "A.* B", true), true);
  assert.equal(e.evaluateKeyword(phrase, "Axxx B", true), false);
  assert.equal(e.evaluateKeyword(phrase, "a.* b", true), false);
  assert.equal(e.evaluateKeyword(phrase, "a.* b", false), true);
  const lower = e.parseKeywordExpressionDetailed("A and B");
  assert.ok(lower.warnings.some((x) => x.code === "KEYWORD_OPERATOR_CASE"));
  assert.ok(lower.warnings.some((x) => x.code === "KEYWORD_IMPLICIT_OR"));
  assert.equal(e.evaluateKeyword(lower.ast, "and", true), true);
});
test("A09 AC-VAL-DEF-01 rejects each invalid enum independently of the others", () => {
  const good = definition([
    field("x", { validationRows: [row("number_less_than", 10)] })
  ]);
  assert.doesNotThrow(() => e.compileForm(good));
  for (const change of [
    (d) => (d.fields[0].valueType = "object"),
    (d) => (d.fields[0].validationRows[0].criteria = "bogus"),
    (d) => (d.fields[0].validationRows[0].operator = "XOR"),
    (d) => (d.fields[0].validationRows[0].caseSensitive = "false"),
    (d) => (d.fields[0].mustBeCorrect = "false")
  ]) {
    const d = structuredClone(good);
    change(d);
    throwsCode(() => e.compileForm(d), "DEFINITION_INVALID");
  }
});
test("A10 every compiled Form compatibility dimension is checked before evaluation", () => {
  const p = planFor("number_less_than", 10);
  for (const key of [
    "registryFingerprint",
    "registryVersion",
    "formulaJsVersion",
    "languageVersion",
    "keywordLanguageVersion",
    "compilerVersion",
    "limitsVersion"
  ])
    throwsCode(
      () => evaluate({ ...p, [key]: "obsolete" }, 1),
      "FORMULA_COMPATIBILITY"
    );
  assert.equal(evaluate(p, 1).canSubmit, true);
});
test("A11 AC-VAL-REV-01 missed edits in another Form cannot preserve approval", () => {
  const form = definition([
    field("x", { validationRows: [row("number_greater_than", 0)] })
  ]);
  const p = e.compileRevision({
    revisionId: "r",
    version: 1,
    formElements: [
      { nodeId: "one", form },
      { nodeId: "two", form }
    ]
  });
  const values = new Map([
      ["one", new Map([["x", 1]])],
      ["two", new Map([["x", 1]])]
    ]),
    previous = e.evaluateRevision(p, values);
  values.get("two").set("x", -1);
  const next = e.evaluateRevisionChangeDetailed(
    p,
    values,
    previous,
    "one",
    "x"
  );
  assert.equal(next.evaluation.canSubmit, false);
  assert.deepEqual(next.evaluation.blockingNodeIds, ["two"]);
  assert.deepEqual(next.statusChangedNodeIds, ["two"]);
  assert.equal(
    next.evaluation.formElements.get("one").evaluation.values.get("x")
      .validationState,
    "valid"
  );
  assert.deepEqual(
    canonical(e.serializeRevisionEvaluation(next.evaluation)),
    canonical(e.serializeRevisionEvaluation(e.evaluateRevision(p, values)))
  );
});
test("A12 Revision incremental input rejects unknown nodes just as full evaluation does", () => {
  const p = e.compileRevision({
    revisionId: "r",
    version: 1,
    formElements: [{ nodeId: "one", form: definition([field()]) }]
  });
  const values = new Map([["one", new Map([["x", 1]])]]),
    previous = e.evaluateRevision(p, values);
  values.set("unexpected", new Map());
  throwsCode(() => e.evaluateRevision(p, values), "PAYLOAD_INVALID");
  throwsCode(
    () => e.evaluateRevisionChange(p, values, previous, "one", "x"),
    "PAYLOAD_INVALID"
  );
});
test("A13 AC-VAL-PERF-04 incremental values and statuses also match an independent arithmetic oracle", () => {
  const d = definition([
    field("limit"),
    field("x", {
      validationRows: [
        row("number_less_than", 0, { expression: 'VALUE - FIELD("limit")' })
      ]
    })
  ]);
  const p = e.compileForm(d),
    values = new Map([
      ["limit", 10],
      ["x", 2]
    ]);
  let old = e.evaluateRecord(p, values);
  for (let i = 0; i < 100; i++) {
    const limit = (i * 17) % 23,
      x = (i * 7) % 23;
    values.set("limit", limit);
    values.set("x", x);
    const detail = e.evaluateChangeDetailed(
      p,
      values,
      old,
      i % 2 ? "x" : "limit"
    );
    old = detail.evaluation;
    assert.equal(
      old.values.get("x").validationRowResults[0].calculatedValue,
      x - limit
    );
    assert.equal(
      old.values.get("x").validationState,
      x < limit ? "valid" : "blocking"
    );
    assert.equal(old.canSubmit, x < limit);
  }
});
test("A14 AC-VAL-SCOPE-03 references follow stable IDs when labels are changed or duplicated", () => {
  const d = definition([
    field("source", { label: "Same label" }),
    field("target", {
      label: "Same label",
      validationRows: [
        row("number_equal_to", 7, { expression: 'FIELD("source")' })
      ]
    })
  ]);
  const values = new Map([
    ["source", 7],
    ["target", 99]
  ]);
  const r = e.evaluateRecord(e.compileForm(d), values);
  assert.equal(r.canSubmit, true);
  assert.equal(r.values.get("source").enteredValue, 7);
  assert.equal(r.values.get("target").enteredValue, 99);
  d.fields[0].label = "Renamed";
  assert.equal(e.evaluateRecord(e.compileForm(d), values).canSubmit, true);
});
test("A15 boundary errors identify the contract violation rather than any incidental exception", () => {
  const p = planFor("number_less_than", 10),
    good = { formId: "audit", formVersion: 1, values: { x: 1 } };
  assert.equal(e.evaluateRecordPayload(p, good).canSubmit, true);
  for (const bad of [
    { ...good, canSubmit: true },
    { ...good, values: { x: 1, unknown: 2 } },
    { ...good, values: { x: {} } },
    { ...good, externalReferences: { x: 1 } }
  ])
    throwsCode(() => e.evaluateRecordPayload(p, bad), "PAYLOAD_INVALID");
  throwsCode(
    () => e.evaluateRecordPayload(p, { ...good, formVersion: 2 }),
    "FORMULA_COMPATIBILITY"
  );
});
test("A16 source values and row results remain isolated when calculations reorder arrays", () => {
  const values = new Map([["x", [3, 1, 2]]]),
    original = structuredClone(values);
  const p = e.compileForm(
    definition([
      field("x", {
        validationRows: [
          row("number_equal_to", 3, {
            id: "large",
            expression: "LARGE(VALUE,1)"
          }),
          row("number_equal_to", 3, {
            id: "first",
            expression: "INDEX(VALUE,1)"
          })
        ]
      })
    ])
  );
  const r = e.evaluateRecord(p, values);
  assert.deepEqual(values, original);
  assert.equal(r.canSubmit, true);
  assert.deepEqual(
    r.values.get("x").validationRowResults.map((x) => x.calculatedValue),
    [3, 3]
  );
});
