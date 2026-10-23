import test from "node:test";
import assert from "node:assert/strict";
import * as e from "../dist/esm/index.js";
const rule = (keyword = 0) => ({
  id: "r",
  criteria: "number_greater_than",
  keyword
});
const field = (id = "x", extra = {}) => ({
  id,
  label: id,
  valueType: "number",
  ...extra
});
const form = (
  fields = [field("x", { mustBeCorrect: true, validationRows: [rule()] })]
) => ({ formId: "f", version: 1, fields });
const evalf = (source, value = null, references = new Map()) =>
  e.evaluateFormula(source, { value, references });
const payload = (values) => ({ formId: "f", formVersion: 1, values });
const controlled = (fn) =>
  assert.throws(fn, (x) => x instanceof e.DcmsRuleError);

test("R01 malformed and ambiguous definitions produce controlled errors", () => {
  for (const d of [
    null,
    undefined,
    [],
    {},
    { formId: 1, version: 1, fields: [] },
    { formId: "f", fields: [] },
    form([null]),
    form([field("x", { mustBeCorrect: "false" })]),
    form([field("x", { label: 1 })]),
    form([field("x", { validationRows: [{ ...rule(), keyword: null }] })]),
    form([field("x", { validationRows: [{ ...rule(), keyword: [] }] })]),
    form([field("x", { validations: [rule()], validationRows: [rule()] })])
  ])
    controlled(() => e.compileForm(d));
  for (const d of [
    null,
    [],
    {},
    { revisionId: "r", version: 1, formElements: [null] }
  ])
    controlled(() => e.compileRevision(d));
});
test("R02 malformed Record payloads and non-JSON runtime values cannot Submit", () => {
  const plan = e.compileForm(form([field()]));
  for (const p of [
    null,
    {},
    payload(undefined),
    payload(null),
    payload([]),
    payload("x"),
    payload({ x: {} }),
    payload({ x: NaN }),
    payload({ x: Infinity }),
    payload({ x: undefined }),
    payload({ x: new Date() }),
    { ...payload({ x: 1 }), formVersion: null },
    { ...payload({ x: 1 }), canSubmit: true }
  ])
    controlled(() => e.evaluateRecordPayload(plan, p));
  const cycle = [];
  cycle.push(cycle);
  controlled(() => e.evaluateRecordPayload(plan, payload({ x: cycle })));
});
test("R03 undeclared values cannot inject an external dependency", () => {
  const plan = e.compileForm(
    form([
      field("x", {
        mustBeCorrect: true,
        validationRows: [{ ...rule(), expression: 'FIELD("approval")' }]
      })
    ])
  );
  controlled(() =>
    e.evaluateRecordPayload(plan, payload({ x: -1, approval: 1 }))
  );
  assert.equal(
    e.evaluateRecordPayload(plan, payload({ x: -1 })).canSubmit,
    false
  );
  assert.equal(
    e.evaluateRecordPayload(plan, {
      ...payload({ x: -1 }),
      externalReferences: { approval: 1 }
    }).canSubmit,
    true
  );
});
test("R04 special property IDs survive JSON round trips as own properties", () => {
  const ids = ["__proto__", "constructor", "toString"];
  const plan = e.compileForm(form(ids.map((id) => field(id))));
  const p = payload(Object.fromEntries(ids.map((id) => [id, 2])));
  const result = JSON.parse(JSON.stringify(e.evaluateRecordPayload(plan, p)));
  for (const id of ids) assert.equal(result.fields[id].enteredValue, 2);
  assert.equal(Object.prototype.polluted, undefined);
  const revision = e.compileRevision({
    revisionId: "r",
    version: 1,
    formElements: [{ nodeId: "__proto__", form: form() }]
  });
  const good = {
    revisionId: "r",
    revisionVersion: 1,
    formElements: Object.fromEntries([["__proto__", payload({ x: 1 })]])
  };
  assert.equal(
    JSON.parse(JSON.stringify(e.evaluateRevisionPayload(revision, good)))
      .formElements.__proto__.evaluation.canSubmit,
    true
  );
  controlled(() =>
    e.evaluateRevisionPayload(revision, { ...good, formElements: {} })
  );
});
test("R05 original definition edits cannot change a compiled plan", () => {
  const definition = form();
  const plan = e.compileForm(definition);
  const before = plan.key;
  definition.fields[0].mustBeCorrect = false;
  definition.fields[0].validationRows[0].keyword = -100;
  assert.equal(e.evaluateRecord(plan, new Map([["x", -1]])).canSubmit, false);
  assert.equal(plan.key, before);
  assert.equal(
    e.evaluateRecord(e.compileForm(definition), new Map([["x", -1]])).canSubmit,
    true
  );
});
test("R06 stale previous Form and Revision results receive a full evaluation", () => {
  const definition = form([field("x"), field("y")]);
  const values = new Map([
    ["x", 1],
    ["y", -1]
  ]);
  const previous = e.evaluateRecord(e.compileForm(definition), values);
  definition.fields[1].mustBeCorrect = true;
  definition.fields[1].validationRows = [rule()];
  const p = e.compileForm(definition);
  const d = e.evaluateChangeDetailed(p, values, previous, "x");
  assert.equal(d.evaluation.canSubmit, false);
  assert.deepEqual(d.affectedFieldIds, ["x", "y"]);
  const rd = {
    revisionId: "r",
    version: 1,
    formElements: [{ nodeId: "n", form: form([field()]) }]
  };
  const rv = new Map([["n", new Map([["x", -1]])]]);
  const prev = e.evaluateRevision(e.compileRevision(rd), rv);
  rd.formElements[0].form = form();
  assert.equal(
    e.evaluateRevisionChange(e.compileRevision(rd), rv, prev, "n", "x")
      .canSubmit,
    false
  );
});
test("R07 edits missed by a debounce cycle and external-data changes invalidate affected results", () => {
  const p = e.compileForm(
    form([
      field("x"),
      field("y", { mustBeCorrect: true, validationRows: [rule()] })
    ])
  );
  const values = new Map([
    ["x", 1],
    ["y", 1]
  ]);
  let prev = e.evaluateRecord(p, values);
  values.set("x", 2);
  values.set("y", -1);
  let next = e.evaluateChangeDetailed(p, values, prev, "x");
  assert.equal(next.evaluation.canSubmit, false);
  assert.deepEqual(next.changedFieldIds, ["x", "y"]);
  const p2 = e.compileForm(
    form([
      field("x"),
      field("y", {
        mustBeCorrect: true,
        validationRows: [{ ...rule(), expression: 'FIELD("limit")' }]
      })
    ])
  );
  const ext = new Map([["limit", 1]]);
  prev = e.evaluateRecord(p2, values, { externalReferences: ext });
  ext.set("limit", -1);
  assert.equal(
    e.evaluateChange(p2, values, prev, "x", { externalReferences: ext })
      .canSubmit,
    false
  );
});
test("R08 unknown change IDs and external-field collisions are rejected", () => {
  const p = e.compileForm(form());
  controlled(() => e.evaluateChange(p, new Map(), undefined, "typo"));
  controlled(() =>
    e.evaluateRecord(p, new Map(), { externalReferences: new Map([["x", 1]]) })
  );
});
test("R09 missing authored fields resolve to BLANK consistently", () => {
  const p = e.compileForm(
    form([
      field("x", {
        validationRows: [
          { ...rule(), expression: 'IF(ISBLANK(FIELD("y")),1,0)' }
        ]
      }),
      field("y")
    ])
  );
  assert.equal(
    e.evaluateRecord(p, new Map()).values.get("x").validationState,
    "valid"
  );
});
test("R10 finite numeric literals and signed zero honor the number contract", () => {
  for (const source of ["1e309", "-1e309", "IF(TRUE,1e309,0)"])
    controlled(() => e.prepareFormula(source));
  assert.equal(evalf("-0=0"), true);
  assert.equal(evalf("-0<>0"), false);
  controlled(() => evalf("VALUE", Infinity));
});
test("R11 keyword operators require entire tokens and recursion is controlled", () => {
  for (const s of ["OR-FAIL", "AND/OR", "NOT.ready", "NOTABLE"])
    assert.equal(
      e.evaluateKeyword(e.parseKeywordExpression(s), s, false),
      true
    );
  for (const s of [
    "NOT ".repeat(1200) + "OK",
    "(".repeat(33) + "OK" + ")".repeat(33)
  ])
    assert.throws(
      () => e.parseKeywordExpression(s),
      (x) =>
        x instanceof e.DcmsRuleError && x.category === "resource_limit_error"
    );
  controlled(() => e.prepareFormula("-".repeat(4000) + "1"));
  controlled(() => e.prepareFormula("1+".repeat(2000) + "1"));
});
test("R12 SUBSTITUTE uses correct nonoverlapping occurrence numbers", () => {
  assert.throws(() => evalf('SUBSTITUTE("abcabc","a","X",1.5)'), {
    code: "FORMULA_BAD_ARGUMENTS"
  });
  assert.equal(evalf('SUBSTITUTE("abcabc","a","X",1)'), "Xbcabc");
  assert.equal(evalf('SUBSTITUTE("abcabc","a","X",2)'), "abcXbc");
  assert.equal(evalf('SUBSTITUTE("aaaa","aa","X",2)'), "aaX");
  assert.equal(evalf('SUBSTITUTE("abc","a","X",9)'), "abc");
  assert.equal(evalf('SUBSTITUTE("abcabc","a","X")'), "XbcXbc");
});
test("R13 predictable output and iteration magnifiers fail before dangerous allocation", () => {
  for (const source of [
    'REPT("x",1000000000)',
    "MUNIT(100000)",
    "BASE(1,2,1000000000)",
    "FACT(1000000)",
    "LCM(1000000000039,3)",
    "MMULT(VALUE,VALUE)"
  ]) {
    const value = source.startsWith("MMULT")
      ? Array.from({ length: 50 }, () => Array(50).fill(1))
      : null;
    assert.throws(
      () => evalf(source, value),
      (x) =>
        x instanceof e.DcmsRuleError && x.code === "FORMULA_LIMIT_EXCEEDED",
      source
    );
  }
  assert.equal(evalf('LEN(REPT("abc",1000))'), 3000);
});
test("R14 registry policy rejects unsafe and environment-dependent lookup functions", () => {
  for (const name of [
    "MATCH",
    "LOOKUP",
    "HLOOKUP",
    "VLOOKUP",
    "TODAY",
    "RAND",
    "NOW",
    "ACCRINT"
  ])
    controlled(() => e.prepareFormula(`${name}(VALUE)`));
  assert.throws(() => {
    e.FUNCTION_REGISTRY[0].name = "CORRUPTED";
  }, TypeError);
});
test("R15 runtime formula errors include exact expression offsets", () => {
  assert.throws(
    () => evalf('=1 + FIELD("missing")'),
    (x) =>
      x.code === "FORMULA_UNRESOLVED_REFERENCE" &&
      x.position === 5 &&
      x.length === 16
  );
});
test("R16 integer length conflicts and keyword guidance preserve meaning", () => {
  controlled(() =>
    e.compileForm(
      form([
        field("x", {
          validationRows: [
            { id: "a", criteria: "character_limit_more_than", keyword: 2 },
            { id: "b", criteria: "character_limit_less_than", keyword: 3 }
          ]
        })
      ])
    )
  );
  const p = e.compileForm(
    form([
      field("x", {
        validationRows: [
          { id: "a", criteria: "required_keywords", keyword: "A OR B" },
          { id: "b", criteria: "required_keywords", keyword: "C OR D" }
        ]
      })
    ])
  );
  assert.match(
    e.getFieldInputGuidance(p, "x").display,
    /\(A OR B\) AND \(C OR D\)/
  );
});
test("R17 invalid cache capacity is rejected instead of looping forever", () => {
  for (const n of [-1, 0, NaN, Infinity, 1.5])
    assert.throws(() => new e.LruCache(n), RangeError);
});
test("R18 Revision payload shapes and extra nodes are rejected", () => {
  const p = e.compileRevision({
    revisionId: "r",
    version: 1,
    formElements: [{ nodeId: "n", form: form() }]
  });
  for (const v of [
    null,
    {},
    { revisionId: "r", revisionVersion: 1, formElements: null },
    {
      revisionId: "r",
      revisionVersion: 1,
      formElements: { n: payload({ x: 1 }), extra: payload({ x: 1 }) }
    },
    { revisionId: "r", revisionVersion: 1, formElements: { n: payload(null) } }
  ])
    controlled(() => e.evaluateRevisionPayload(p, v));
});
test("R19 in-place checkbox edits cannot conceal changed values", () => {
  const p = e.compileForm(
    form([
      field("x", {
        mustBeCorrect: true,
        validationRows: [
          {
            ...rule(),
            criteria: "selection_values_include_all",
            keyword: ["A", "B"]
          }
        ]
      }),
      field("y")
    ])
  );
  const selected = ["A", "B"];
  const values = new Map([
    ["x", selected],
    ["y", 1]
  ]);
  const prev = e.evaluateRecord(p, values);
  selected.pop();
  assert.equal(e.evaluateChange(p, values, prev, "y").canSubmit, false);
});
test("R20 JSON structural values retain FALSE, zero, empty text and BLANK distinctly", () => {
  const p = e.compileForm(form(["f", "z", "s", "n"].map((id) => field(id))));
  const v = { f: false, z: 0, s: "", n: null };
  const r = e.evaluateRecordPayload(p, payload(v));
  for (const [id, value] of Object.entries(v))
    assert.equal(r.fields[id].enteredValue, value);
});
