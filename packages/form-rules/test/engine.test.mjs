import { readFileSync } from "node:fs";
const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url))
).version;
/** Core behavioral contract tests. Names describe the architectural invariant or edge case being protected. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  affectedFields,
  compileForm,
  compileRevision,
  combineValidationRowResults,
  diagnoseFormula,
  diagnoseKeywordExpression,
  evaluateBatch,
  evaluateChange,
  evaluateChangeDetailed,
  evaluateKeyword,
  evaluatePreparedFormula,
  evaluateRecord,
  evaluateRecordPayload,
  evaluateRevision,
  evaluateRevisionChangeDetailed,
  evaluateRevisionPayload,
  getFieldInputGuidance,
  recordValuesToMap,
  serializeRecordEvaluation,
  formulaJsRegistrySummary,
  getCompiledPlanStats,
  getCompiledPlanCacheKey,
  parseFormula,
  parseKeywordExpression,
  parseKeywordExpressionDetailed,
  prepareFormula,
  validateFormDefinition,
  validateRevisionDefinition
} from "../dist/esm/index.js";

const emptyRefs = new Map();
const evalFormula = (source, value = null, refs = emptyRefs) =>
  evaluatePreparedFormula(prepareFormula(source), { value, references: refs });

test("formula parser and Required Keywords parser remain separate languages", () => {
  assert.equal(evalFormula("=1 + 2 * 3"), 7);
  const kw = parseKeywordExpression("ABC AND (DEF OR XYZ)");
  assert.equal(evaluateKeyword(kw, "abc xyz", false), true);
  const implicit = parseKeywordExpressionDetailed("ABC XYZ");
  assert.equal(evaluateKeyword(implicit.ast, "XYZ", false), true);
  assert.ok(implicit.warnings.some((w) => w.code === "KEYWORD_IMPLICIT_OR"));
});

test("generic Chevrotain function rule supports ordinary and dotted Formula.js names", () => {
  assert.equal(evalFormula("=SUM(1, 2, 3)"), 6);
  assert.equal(evalFormula("=MEDIAN(1, 9, 5)"), 5);
  assert.equal(evalFormula("=NORM.DIST(1, 0, 1, TRUE)"), 0.8413447460685429);
  assert.ok(
    Math.abs(evalFormula("=PMT(0.05/12, 60, 10000)") + 188.7123364401099) <
      1e-10
  );
});

test("Formula.js catalog is broadly exposed through the DCMS registry", () => {
  const s = formulaJsRegistrySummary();
  assert.equal(s.formulaJsVersion, "4.6.1");
  assert.equal(s.counts.supported, 387);
  assert.equal(s.counts.dcms_implemented, 8);
  assert.equal(s.counts.pending_date_semantics, 34);
  assert.equal(s.counts.excluded_spreadsheet_context, 2);
  assert.equal(s.counts.pending_error_value_semantics, 7);
  assert.equal(s.counts.excluded_nondeterministic, 4);
  assert.equal(s.counts.dcms_specific, 7);
  assert.equal(s.counts.pending_environment_semantics, 3);
  assert.equal(s.counts.pending_unsafe_semantics, 1);
  assert.equal(s.total, 453);
});

test("Formula.js public catalog includes nested aliases and excludes internal utils helpers", () => {
  assert.equal(evalFormula("=CEILING.MATH(4.2)"), 5);
  assert.equal(evalFormula("=NORM.S.DIST(0, TRUE)"), 0.5);
  assert.equal(evalFormula("=BINOM.DIST.RANGE(10, 0.5, 4, 6)"), 0.65625);
  assert.ok(
    Math.abs(evalFormula("=T.DIST.RT(1, 10)") - 0.17044656615111398) < 1e-14
  );
  assert.throws(
    () => prepareFormula("=NETWORKDAYS.INTL(1, 2)"),
    /date representation/i
  );
  assert.throws(
    () => prepareFormula("=utils.symbols.ADD(1, 2)"),
    /Unknown formula function/i
  );
});
test("nondeterministic and unresolved date functions are excluded", () => {
  assert.throws(() => prepareFormula("=NOW()"), /excluded/);
  assert.throws(() => prepareFormula("=TODAY()"), /excluded/);
  assert.throws(() => prepareFormula("=RAND()"), /excluded/);
  assert.throws(
    () => prepareFormula("=DATE(2026, 9, 22)"),
    /date representation/i
  );
});

test("native Boolean operators short-circuit and preserve precedence", () => {
  assert.equal(evalFormula("=FALSE AND 100 / 0 > 1"), false);
  assert.equal(evalFormula("=TRUE OR 100 / 0 > 1"), true);
  assert.equal(evalFormula("=TRUE OR FALSE AND FALSE"), true);
  assert.equal(evalFormula("=NOT FALSE AND TRUE"), true);
});

test("IF is lazy and does not evaluate the unused branch", () => {
  assert.equal(evalFormula("=IF(VALUE = 0, 0, 100 / VALUE)", 0), 0);
  assert.equal(evalFormula("=IF(VALUE = 0, 0, 100 / VALUE)", 4), 25);
});

test("Formula.js text/math functions and normal arithmetic unit conversion work", () => {
  assert.equal(evalFormula("=ROUND((VALUE - 32) * 5 / 9, 2)", 212), 100);
  assert.equal(evalFormula("=ABS(-12.5)"), 12.5);
  assert.equal(evalFormula('=UPPER(TRIM("  ab cd  "))'), "AB CD");
  assert.equal(evalFormula('="Lot " & VALUE & "-A"', 42), "Lot 42-A");
  assert.equal(evalFormula('="Valve ""A"""'), 'Valve "A"');
});

test("stable FIELD reference and bare DCMS references resolve from explicit context", () => {
  const refs = new Map([
    ["temperature-inlet", 18],
    ["A", 7]
  ]);
  assert.equal(evalFormula('=FIELD("temperature-inlet") + 2', null, refs), 20);
  assert.equal(evalFormula("=A * 3", null, refs), 21);
});

test("each validation row may apply its own optional formula before its criterion", () => {
  const def = {
    formId: "f",
    version: 1,
    fields: [
      {
        id: "tempF",
        label: "Temperature",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "c-min",
            expression: "=ROUND((VALUE-32)*5/9,2)",
            criteria: "number_greater_than",
            keyword: 95
          },
          {
            id: "c-max",
            operator: "AND",
            expression: "=ROUND((VALUE-32)*5/9,2)",
            criteria: "number_less_than",
            keyword: 105
          },
          {
            id: "alarm",
            operator: "AND",
            expression: "=IF(VALUE > 230,1,0)",
            criteria: "number_equal_to",
            keyword: 0
          }
        ]
      }
    ]
  };
  const r = evaluateRecord(compileForm(def), new Map([["tempF", 212]]));
  const f = r.values.get("tempF");
  assert.equal(f.enteredValue, 212);
  assert.equal(f.calculatedValue, 212); // row formulas do not replace the source field value
  assert.equal(f.validationRowResults[0].calculatedValue, 100);
  assert.equal(f.validationPassed, true);
  assert.equal(r.canSubmit, true);
});

test("row operators combine independent row results with NOT > AND > OR precedence", () => {
  const def = {
    formId: "f",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          { id: "r1", criteria: "number_greater_than", keyword: 100 },
          { id: "r2", operator: "OR", criteria: "number_equal_to", keyword: 50 }
        ]
      }
    ]
  };
  const r = evaluateRecord(compileForm(def), new Map([["x", 50]]));
  assert.equal(r.values.get("x").validationPassed, true);
  assert.equal(r.canSubmit, true);
});

test("AND-family rows bind before OR-family rows, including AND NOT and OR NOT", () => {
  const rules = [
    {
      operator: "AND",
      criteria: "number_equal_to",
      keyword: 1,
      caseSensitive: false
    },
    {
      operator: "OR",
      criteria: "number_equal_to",
      keyword: 1,
      caseSensitive: false
    },
    {
      operator: "AND NOT",
      criteria: "number_equal_to",
      keyword: 1,
      caseSensitive: false
    },
    {
      operator: "OR NOT",
      criteria: "number_equal_to",
      keyword: 1,
      caseSensitive: false
    },
    {
      operator: "AND",
      criteria: "number_equal_to",
      keyword: 1,
      caseSensitive: false
    }
  ];
  // A OR (B AND NOT C) OR ((NOT D) AND E)
  assert.equal(
    combineValidationRowResults(rules, [false, true, true, true, true]),
    false
  );
  assert.equal(
    combineValidationRowResults(rules, [false, true, false, true, false]),
    true
  );
  assert.equal(
    combineValidationRowResults(rules, [false, false, true, false, true]),
    true
  );
  assert.equal(
    combineValidationRowResults(rules, [true, false, true, true, false]),
    true
  );
});

test("validation rows are field-local and row calculations do not feed later rows", () => {
  const plan = compileForm({
    formId: "scope",
    version: 1,
    fields: [
      {
        id: "a",
        label: "A",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "a1",
            expression: "=VALUE*2",
            criteria: "number_equal_to",
            keyword: 10
          },
          {
            id: "a2",
            operator: "AND",
            expression: "=VALUE+1",
            criteria: "number_equal_to",
            keyword: 6
          }
        ]
      },
      {
        id: "b",
        label: "B",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [{ id: "b1", criteria: "number_equal_to", keyword: 7 }]
      }
    ]
  });
  const entered = new Map([
    ["a", 5],
    ["b", 7]
  ]);
  const initial = evaluateRecord(plan, entered);
  assert.deepEqual(
    initial.values.get("a").validationRowResults.map((r) => r.calculatedValue),
    [10, 6]
  );
  assert.equal(initial.values.get("b").validationState, "valid");

  entered.set("a", 6);
  const detail = evaluateChangeDetailed(plan, entered, initial, "a");
  assert.deepEqual(detail.affectedFieldIds, ["a"]);
  assert.equal(detail.evaluation.values.get("b"), initial.values.get("b"));
  assert.equal(detail.evaluation.values.get("b").validationState, "valid");
});

test("Formula.js calls cannot mutate authoritative array inputs or cross-row state", () => {
  const source = [3, 1, 2];
  const refs = new Map([["arr", source]]);
  assert.equal(evalFormula('=LARGE(FIELD("arr"),1)', null, refs), 3);
  assert.deepEqual(source, [3, 1, 2]);
  assert.deepEqual(refs.get("arr"), [3, 1, 2]);
});

test("incremental evaluation is equivalent to a fresh full evaluation across edits", () => {
  const plan = compileForm({
    formId: "equivalence",
    version: 1,
    fields: [
      {
        id: "a",
        label: "A",
        valueType: "number",
        validationRows: [
          { id: "a1", criteria: "number_greater_than", keyword: 0 }
        ]
      },
      {
        id: "b",
        label: "B",
        valueType: "number",
        validationRows: [
          {
            id: "b1",
            expression: '=VALUE+FIELD("a")',
            criteria: "number_less_than",
            keyword: 20
          }
        ]
      },
      {
        id: "c",
        label: "C",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          { id: "c1", criteria: "number_greater_than", keyword: 2 },
          { id: "c2", operator: "OR", criteria: "number_equal_to", keyword: 1 },
          {
            id: "c3",
            operator: "AND NOT",
            criteria: "number_equal_to",
            keyword: 5
          }
        ]
      }
    ]
  });
  const entered = new Map([
    ["a", 3],
    ["b", 4],
    ["c", 3]
  ]);
  let incremental = evaluateRecord(plan, entered);
  for (const [field, value] of [
    ["a", 7],
    ["b", 8],
    ["c", 1],
    ["a", 2],
    ["c", 5]
  ]) {
    entered.set(field, value);
    incremental = evaluateChange(plan, entered, incremental, field);
    const full = evaluateRecord(plan, entered);
    assert.deepEqual(
      serializeRecordEvaluation(incremental),
      serializeRecordEvaluation(full)
    );
  }
});

test("ordinary validation failures block Submit only when Must Be Correct is enabled", () => {
  const def = {
    formId: "f",
    version: 1,
    fields: [
      {
        id: "strict",
        label: "Strict",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [{ id: "s", criteria: "number_less_than", keyword: 10 }]
      },
      {
        id: "warn",
        label: "Warn",
        valueType: "number",
        mustBeCorrect: false,
        validationRows: [{ id: "w", criteria: "number_less_than", keyword: 10 }]
      }
    ]
  };
  const r = evaluateRecord(
    compileForm(def),
    new Map([
      ["strict", 12],
      ["warn", 12]
    ])
  );
  assert.equal(r.canSave, true);
  assert.equal(r.canSubmit, false);
  assert.deepEqual(r.blockingFieldIds, ["strict"]);
  assert.deepEqual(r.warningFieldIds, ["warn"]);
});

test("field validation has four ordinary states and keeps evaluation error separate", () => {
  const plan = compileForm({
    formId: "states",
    version: 1,
    fields: [
      { id: "none", label: "None", valueType: "number" },
      {
        id: "valid",
        label: "Valid",
        valueType: "number",
        validationRows: [{ id: "v", criteria: "number_less_than", keyword: 10 }]
      },
      {
        id: "warning",
        label: "Warning",
        valueType: "number",
        mustBeCorrect: false,
        validationRows: [{ id: "w", criteria: "number_less_than", keyword: 10 }]
      },
      {
        id: "blocking",
        label: "Blocking",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [{ id: "b", criteria: "number_less_than", keyword: 10 }]
      },
      {
        id: "error",
        label: "Error",
        valueType: "number",
        validationRows: [
          {
            id: "e",
            expression: "=1/(VALUE-5)",
            criteria: "number_greater_than",
            keyword: 0
          }
        ]
      }
    ]
  });
  const result = evaluateRecord(
    plan,
    new Map([
      ["none", 1],
      ["valid", 5],
      ["warning", 12],
      ["blocking", 12],
      ["error", 5]
    ])
  );
  assert.equal(result.values.get("none").validationState, "not_validated");
  assert.equal(result.values.get("valid").validationState, "valid");
  assert.equal(result.values.get("warning").validationState, "warning");
  assert.equal(result.values.get("blocking").validationState, "blocking");
  assert.equal(result.values.get("error").validationState, null);
  assert.equal(result.values.get("error").evaluationState, "error");
  assert.equal(result.values.get("valid").evaluationState, "ok");
  assert.equal(result.values.get("none").hasValidation, false);
  assert.equal(result.values.get("valid").hasValidation, true);
  assert.deepEqual(result.unvalidatedFieldIds, ["none"]);
  assert.deepEqual(result.validFieldIds, ["valid"]);
  assert.deepEqual(result.warningFieldIds, ["warning"]);
  assert.deepEqual(result.blockingFieldIds, ["blocking", "error"]);
  assert.deepEqual(result.errorFieldIds, ["error"]);
});

test("compiled input guidance exposes direct ranges and does not invent inverse ranges for transformed formulas", () => {
  const plan = compileForm({
    formId: "guidance",
    version: 1,
    fields: [
      {
        id: "temp",
        label: "Temperature",
        valueType: "number",
        validationRows: [
          { id: "min", criteria: "number_greater_than", keyword: -40 },
          {
            id: "max",
            operator: "AND",
            criteria: "number_less_than",
            keyword: 230
          }
        ]
      },
      {
        id: "converted",
        label: "Converted",
        valueType: "number",
        validationRows: [
          {
            id: "c",
            expression: "=VALUE*2",
            criteria: "number_less_than",
            keyword: 100
          }
        ]
      },
      { id: "plain", label: "Plain", valueType: "string" }
    ]
  });
  const temp = getFieldInputGuidance(plan, "temp");
  assert.equal(temp.kind, "numeric_range");
  assert.equal(temp.appliesTo, "entered_value");
  assert.deepEqual(temp.numericRange, {
    lower: { value: -40, inclusive: false },
    upper: { value: 230, inclusive: false }
  });
  assert.match(temp.display, /> -40/);
  assert.match(temp.display, /< 230/);

  const converted = getFieldInputGuidance(plan, "converted");
  assert.equal(converted.kind, "criteria_summary");
  assert.equal(converted.appliesTo, "calculated_value");
  assert.match(converted.display, /Calculated-value criteria/i);
  assert.equal(converted.numericRange, undefined);

  const plain = getFieldInputGuidance(plan, "plain");
  assert.equal(plain.kind, "none");
  assert.equal(plain.display, "No validation applied");
});

test("Required Keywords supports explicit operators, precedence, implicit OR, and escaped quotes", () => {
  const ast = parseKeywordExpression(
    'Valve AND (READY OR "A \\"special\\" part")'
  );
  assert.equal(evaluateKeyword(ast, 'Valve A "special" part', false), true);
  assert.equal(diagnoseKeywordExpression("ABC AND").state, "incomplete");
  assert.equal(diagnoseKeywordExpression("AND ABC").state, "invalid");

  const d = diagnoseKeywordExpression("ABC DEF AND XYZ");
  assert.equal(d.state, "valid");
  assert.ok(d.warnings?.some((w) => w.code === "KEYWORD_IMPLICIT_OR"));
  const implicit = parseKeywordExpression("ABC DEF AND XYZ");
  assert.equal(evaluateKeyword(implicit, "DEF XYZ", false), true);
  assert.equal(evaluateKeyword(implicit, "ABC only", false), true);
});

test("Required Keywords logical operators are case-sensitive and lowercase words remain literals", () => {
  const ast = parseKeywordExpression("ABC and DEF");
  assert.equal(evaluateKeyword(ast, "ABC", false), true); // ABC OR and OR DEF
  assert.equal(evaluateKeyword(ast, "and", false), true);
  const d = diagnoseKeywordExpression("ABC and DEF");
  assert.equal(d.state, "valid");
  assert.ok(d.warnings?.some((w) => w.code === "KEYWORD_OPERATOR_CASE"));
  assert.ok(d.warnings?.some((w) => w.code === "KEYWORD_IMPLICIT_OR"));

  const explicit = parseKeywordExpression("ABC AND DEF");
  assert.equal(evaluateKeyword(explicit, "ABC", false), false);
  assert.equal(evaluateKeyword(explicit, "ABC DEF", false), true);
});

test("formula authoring diagnostics distinguish valid from incomplete syntax", () => {
  assert.equal(diagnoseFormula("=MAX(VALUE, 10)").state, "valid");
  assert.equal(diagnoseFormula("=MAX(VALUE, 10").state, "incomplete");
});

test("implicit OR is valid rule configuration but produces a non-blocking authoring warning", () => {
  const issues = validateFormDefinition({
    formId: "f",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "string",
        validationRows: [
          { id: "kw", criteria: "required_keywords", keyword: "ABC XYZ" }
        ]
      }
    ]
  });
  assert.equal(
    issues.some((x) => x.severity === "error"),
    false
  );
  assert.ok(
    issues.some(
      (x) =>
        x.severity === "warning" && x.code.startsWith("KEYWORD_IMPLICIT_OR")
    )
  );
});

test("cross-field validation dependencies drive incremental reevaluation", () => {
  const def = {
    formId: "f",
    version: 1,
    fields: [
      { id: "a", label: "A", valueType: "number" },
      {
        id: "b",
        label: "B",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "b1",
            expression: '=VALUE - FIELD("a")',
            criteria: "number_less_than",
            keyword: 10
          }
        ]
      }
    ]
  };
  const plan = compileForm(def);
  const entered = new Map([
    ["a", 5],
    ["b", 12]
  ]);
  let r = evaluateRecord(plan, entered);
  assert.equal(r.values.get("b").validationRowResults[0].calculatedValue, 7);
  entered.set("a", 10);
  assert.deepEqual([...affectedFields(plan, "a")].sort(), ["a", "b"]);
  r = evaluateChange(plan, entered, r, "a");
  assert.equal(r.values.get("b").validationRowResults[0].calculatedValue, 2);
});

test("evaluateChangeDetailed identifies affected fields without repainting unrelated rows", () => {
  const plan = compileForm({
    formId: "detail",
    version: 1,
    fields: [
      { id: "a", label: "A", valueType: "number" },
      {
        id: "b",
        label: "B",
        valueType: "number",
        validationRows: [
          { id: "b1", criteria: "number_less_than", keyword: 10 }
        ]
      },
      {
        id: "c",
        label: "C",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "c1",
            expression: '=VALUE-FIELD("a")',
            criteria: "number_less_than",
            keyword: 10
          }
        ]
      }
    ]
  });
  const entered = new Map([
    ["a", 5],
    ["b", 5],
    ["c", 12]
  ]);
  const initial = evaluateRecord(plan, entered);
  assert.equal(initial.values.get("c").validationState, "valid");
  entered.set("a", 0);
  const detail = evaluateChangeDetailed(plan, entered, initial, "a");
  assert.deepEqual(detail.changedFieldIds, ["a"]);
  assert.deepEqual(detail.affectedFieldIds, ["a", "c"]);
  assert.deepEqual(detail.statusChangedFieldIds, ["c"]);
  assert.equal(detail.evaluation.values.get("b"), initial.values.get("b"));
  assert.equal(detail.evaluation.values.get("c").validationState, "blocking");
});

test("legacy field-wide expression remains supported for existing definitions", () => {
  const def = {
    formId: "legacy",
    version: 1,
    fields: [
      {
        id: "temp",
        label: "Temperature",
        valueType: "number",
        expression: "=ROUND((VALUE-32)*5/9,2)",
        mustBeCorrect: true,
        validations: [{ criteria: "number_less_than", keyword: 120 }]
      }
    ]
  };
  const r = evaluateRecord(compileForm(def), new Map([["temp", 212]]));
  assert.equal(r.values.get("temp").calculatedValue, 100);
  assert.equal(r.canSubmit, true);
});

test("batch records reuse one compiled plan", () => {
  const plan = compileForm({
    formId: "f",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          {
            id: "r",
            expression: "=VALUE*2",
            criteria: "number_less_than",
            keyword: 20
          }
        ]
      }
    ]
  });
  const out = evaluateBatch(plan, [
    { recordId: "r1", entered: new Map([["x", 3]]) },
    { recordId: "r2", entered: new Map([["x", 7]]) }
  ]);
  assert.deepEqual(
    out.map(
      (x) =>
        x.evaluation.values.get("x").validationRowResults[0].calculatedValue
    ),
    [6, 14]
  );
});

test("compiled plan reports prepared formula nodes and validation counts", () => {
  const plan = compileForm({
    formId: "stats",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: Array.from({ length: 10 }, (_, i) => ({
          id: `r${i}`,
          expression: "=ROUND(VALUE*2,2)",
          criteria: i < 5 ? "number_greater_than" : "number_less_than",
          keyword: i < 5 ? -100 + i : 100 + i
        }))
      }
    ]
  });
  const stats = getCompiledPlanStats(plan);
  assert.equal(stats.fieldCount, 1);
  assert.equal(stats.formulaCount, 10);
  assert.equal(stats.validationRuleCount, 10);
  assert.ok(stats.formulaInstructionCells > 10); // v0.8 field retained for compatibility; value is prepared AST node count.
});

test("prepared formulas and compiled plans carry explicit compatibility metadata", () => {
  const prepared = prepareFormula("=ROUND(VALUE, 2)");
  assert.equal(prepared.languageVersion, "1.1");
  assert.equal(prepared.registryVersion, "3");
  assert.equal(prepared.formulaJsVersion, "4.6.1");
  assert.equal(prepared.compilerVersion, packageVersion);
  assert.equal(prepared.limitsVersion, "3");
  assert.ok(prepared.registryFingerprint);
  assert.ok(prepared.sourceHash);
  const plan = compileForm({
    formId: "meta",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          {
            id: "r1",
            expression: "=ROUND(VALUE,2)",
            criteria: "number_greater_than",
            keyword: 0
          }
        ]
      }
    ]
  });
  assert.equal(plan.registryVersion, "3");
  assert.equal(plan.formulaJsVersion, "4.6.1");
  assert.equal(plan.compilerVersion, packageVersion);
  assert.equal(plan.limitsVersion, "3");
});

test("DCMS BLANK semantics are explicit and conservative", () => {
  assert.equal(evalFormula("=VALUE = VALUE", null), true);
  assert.equal(evalFormula("=VALUE = 0", null), false);
  assert.equal(evalFormula('=VALUE = ""', null), false);
  assert.equal(evalFormula('=VALUE & "A"', null), "A");
  assert.equal(evalFormula("=SUM(VALUE, 5)", null), 5);
  assert.equal(evalFormula("=MAX(VALUE, 5)", null), 5);
  assert.equal(evalFormula("=ISBLANK(VALUE)", null), true);
  assert.equal(evalFormula("=LEN(VALUE)", null), 0);
  assert.throws(() => evalFormula("=VALUE + 5", null), /Expected a number/);
  assert.throws(
    () => evalFormula("=VALUE AND TRUE", null),
    /Expected a Boolean/
  );
});

test("numeric results are finite and mathematical failures are controlled errors", () => {
  assert.throws(() => evalFormula("=1 / 0"), /Division by zero/);
  assert.throws(() => evalFormula("=10 ^ 1000"), /non-finite result/);
  assert.throws(() => evalFormula("=1e308 + 1e308"), /non-finite result/);
  assert.throws(() => evalFormula("=-1e308 - 1e308"), /non-finite result/);
  assert.throws(() => evalFormula("=1e308 * 1e308"), /non-finite result/);
  assert.throws(() => evalFormula("=1e308 / 1e-308"), /non-finite result/);
});

test("runtime row-formula errors cannot be masked by OR and always block Submit", () => {
  const plan = compileForm({
    formId: "runtime-error",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        mustBeCorrect: false,
        validationRows: [
          { id: "pass", criteria: "number_equal_to", keyword: 5 },
          {
            id: "boom",
            operator: "OR",
            expression: "=100 / (VALUE - 5)",
            criteria: "number_greater_than",
            keyword: 0
          }
        ]
      }
    ]
  });
  const result = evaluateRecord(plan, new Map([["x", 5]]));
  assert.equal(result.canSave, true);
  assert.equal(result.canSubmit, false);
  assert.deepEqual(result.errorFieldIds, ["x"]);
  assert.deepEqual(result.blockingFieldIds, ["x"]);
  assert.ok(
    result.values
      .get("x")
      .evaluationErrors.some((x) => /Division by zero/i.test(x))
  );
});

test("AND NOT failure has an explanatory combined-result diagnostic", () => {
  const plan = compileForm({
    formId: "and-not",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "r1",
            label: "Positive",
            criteria: "number_greater_than",
            keyword: 0
          },
          {
            id: "r2",
            label: "Forbidden exact value",
            operator: "AND NOT",
            criteria: "number_equal_to",
            keyword: 5
          }
        ]
      }
    ]
  });
  const result = evaluateRecord(plan, new Map([["x", 5]]));
  const field = result.values.get("x");
  assert.equal(field.validationPassed, false);
  assert.equal(result.canSubmit, false);
  assert.ok(field.failures.some((x) => /AND NOT condition matched/i.test(x)));
});

test("compileForm rejects semantically invalid definitions before producing a plan", () => {
  assert.throws(
    () =>
      compileForm({
        formId: "invalid",
        version: 1,
        fields: [
          {
            id: "x",
            label: "X",
            valueType: "number",
            validationRows: [
              {
                id: "r1",
                criteria: "number_less_than",
                keyword: "not-a-number"
              }
            ]
          }
        ]
      }),
    /Form definition is invalid:.*Numeric validation requires a valid number/i
  );
});

test("compiled plan cache identity includes definition content and full compatibility metadata", () => {
  const a = {
    formId: "cache",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          { id: "r1", criteria: "number_less_than", keyword: 10 }
        ]
      }
    ]
  };
  const b = {
    formId: "cache",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          { id: "r1", criteria: "number_less_than", keyword: 11 }
        ]
      }
    ]
  };
  const plan = compileForm(a);
  assert.ok(plan.sourceHash);
  assert.equal(plan.key, getCompiledPlanCacheKey(a));
  assert.notEqual(getCompiledPlanCacheKey(a), getCompiledPlanCacheKey(b));
  assert.match(plan.registryFingerprint, /^dcms-registry:3:[0-9a-f]{16}$/);
  assert.throws(
    () =>
      evaluateRecord({ ...plan, compilerVersion: "old" }, new Map([["x", 5]])),
    /compiler version/i
  );
});

test("prepared formulas reject compatibility metadata or source-hash drift", () => {
  const prepared = prepareFormula("=VALUE + 1");
  assert.throws(
    () =>
      evaluatePreparedFormula(
        { ...prepared, compilerVersion: "old" },
        { value: 1, references: emptyRefs }
      ),
    /compiler version/i
  );
  assert.throws(
    () =>
      evaluatePreparedFormula(
        { ...prepared, source: "=VALUE + 2" },
        { value: 1, references: emptyRefs }
      ),
    /source hash/i
  );
});

test("formula authoring limits reject over-limit source, nesting and argument counts", () => {
  const tooLong = "=" + "1+".repeat(4096) + "1";
  assert.throws(() => prepareFormula(tooLong), /maximum length/i);
  const tooDeep = "=" + "(".repeat(65) + "1" + ")".repeat(65);
  assert.throws(() => prepareFormula(tooDeep), /nesting depth/i);
  const tooManyArgs =
    "=SUM(" + Array.from({ length: 256 }, () => "1").join(",") + ")";
  assert.throws(() => prepareFormula(tooManyArgs), /maximum of 255 arguments/i);
});

test("Required Keywords supports long paragraph phrases within controlled v2 limits", () => {
  const longPhrase = "A".repeat(6000);
  const target = `prefix ${longPhrase} suffix`;
  const ast = parseKeywordExpression('"' + longPhrase + '"');
  assert.equal(evaluateKeyword(ast, target, true), true);

  assert.throws(
    () => parseKeywordExpression("A".repeat(16385)),
    /maximum length of 16384/i
  );
  assert.throws(
    () => parseKeywordExpression('"' + "A".repeat(8193) + '"'),
    /maximum length of 8192/i
  );

  const tooDeep = "(".repeat(33) + "A" + ")".repeat(33);
  assert.throws(() => parseKeywordExpression(tooDeep), /parenthesis depth/i);
});

test("Required Keywords is literal substring matching, not user-authored Regex", () => {
  const ast = parseKeywordExpression('"A.*B"');
  assert.equal(evaluateKeyword(ast, "literal A.*B text", true), true);
  assert.equal(evaluateKeyword(ast, "A---B", true), false);
});

test("Revision aggregation keeps Form Elements independent and evaluates whole-Revision Submit state", () => {
  const revision = compileRevision({
    revisionId: "rev-a",
    version: 1,
    formElements: [
      {
        nodeId: "node-1",
        label: "Form 1",
        form: {
          formId: "f1",
          version: 1,
          fields: [
            {
              id: "x",
              label: "X",
              valueType: "number",
              mustBeCorrect: true,
              validationRows: [
                { id: "r1", criteria: "number_less_than", keyword: 10 }
              ]
            }
          ]
        }
      },
      {
        nodeId: "node-2",
        label: "Form 2",
        form: {
          formId: "f2",
          version: 1,
          fields: [
            {
              id: "y",
              label: "Y",
              valueType: "number",
              mustBeCorrect: false,
              validationRows: [
                { id: "r2", criteria: "number_less_than", keyword: 10 }
              ]
            }
          ]
        }
      },
      {
        nodeId: "node-3",
        label: "Form 3",
        form: {
          formId: "f3",
          version: 1,
          fields: [{ id: "z", label: "Z", valueType: "string" }]
        }
      }
    ]
  });
  const entered = new Map([
    ["node-1", new Map([["x", 5]])],
    ["node-2", new Map([["y", 12]])],
    ["node-3", new Map([["z", "ABC"]])]
  ]);
  const result = evaluateRevision(revision, entered);
  assert.equal(result.canSubmit, true);
  assert.deepEqual(result.validNodeIds, ["node-1"]);
  assert.deepEqual(result.warningNodeIds, ["node-2"]);
  assert.deepEqual(result.unvalidatedNodeIds, ["node-3"]);
  assert.deepEqual(result.blockingNodeIds, []);

  entered.get("node-1").set("x", 15);
  const detail = evaluateRevisionChangeDetailed(
    revision,
    entered,
    result,
    "node-1",
    "x"
  );
  assert.equal(detail.evaluation.canSubmit, false);
  assert.deepEqual(detail.evaluation.blockingNodeIds, ["node-1"]);
  assert.deepEqual(detail.statusChangedNodeIds, ["node-1"]);
  assert.deepEqual(detail.affectedFieldIds, ["x"]);
  assert.equal(
    detail.evaluation.formElements.get("node-2"),
    result.formElements.get("node-2")
  );
});

test("Revision definition validation rejects duplicate Form Element node IDs", () => {
  const definition = {
    revisionId: "rev",
    version: 1,
    formElements: [
      { nodeId: "same", form: { formId: "f1", version: 1, fields: [] } },
      { nodeId: "same", form: { formId: "f2", version: 1, fields: [] } }
    ]
  };
  const issues = validateRevisionDefinition(definition);
  assert.ok(issues.some((issue) => issue.code === "NODE-ID-DUP"));
  assert.throws(
    () => compileRevision(definition),
    /Duplicate Form Element node ID same/i
  );
});

test("Revision JSON/API boundary validates Revision and nested Form identities", () => {
  const plan = compileRevision({
    revisionId: "rev-json",
    version: 4,
    formElements: [
      {
        nodeId: "n1",
        form: {
          formId: "f1",
          version: 2,
          fields: [
            {
              id: "x",
              label: "X",
              valueType: "number",
              validationRows: [
                { id: "r", criteria: "number_less_than", keyword: 10 }
              ]
            }
          ]
        }
      },
      {
        nodeId: "n2",
        form: {
          formId: "f2",
          version: 7,
          fields: [{ id: "y", label: "Y", valueType: "string" }]
        }
      }
    ]
  });
  const payload = {
    revisionId: "rev-json",
    revisionVersion: 4,
    formElements: {
      n1: { formId: "f1", formVersion: 2, values: { x: 5 } },
      n2: { formId: "f2", formVersion: 7, values: { y: "abc" } }
    }
  };
  const json = evaluateRevisionPayload(plan, payload);
  assert.equal(json.canSubmit, true);
  assert.deepEqual(json.validNodeIds, ["n1"]);
  assert.deepEqual(json.unvalidatedNodeIds, ["n2"]);
  assert.equal(
    json.formElements.n1.evaluation.fields.x.validationState,
    "valid"
  );
  assert.throws(
    () => evaluateRevisionPayload(plan, { ...payload, revisionVersion: 5 }),
    /compiled plan is rev-json version 4/i
  );
  assert.throws(
    () =>
      evaluateRevisionPayload(plan, {
        ...payload,
        formElements: {
          ...payload.formElements,
          n1: { ...payload.formElements.n1, formVersion: 3 }
        }
      }),
    /compiled node is f1 version 2/i
  );
  assert.throws(
    () =>
      evaluateRevisionPayload(plan, {
        ...payload,
        formElements: { n1: payload.formElements.n1 }
      }),
    /missing Form Element node n2/i
  );
});

test("JSON/API boundary preserves authoritative Form identity and JSON-safe results", () => {
  const plan = compileForm({
    formId: "json-contract",
    version: 3,
    fields: [
      {
        id: "temperature_f",
        label: "Temperature",
        valueType: "number",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "c-max",
            expression: "=ROUND((VALUE-32)*5/9,2)",
            criteria: "number_less_than",
            keyword: 105
          }
        ]
      }
    ]
  });

  const mapped = recordValuesToMap({ temperature_f: 212 });
  assert.equal(mapped.get("temperature_f"), 212);

  const internal = evaluateRecord(plan, mapped);
  const json = serializeRecordEvaluation(internal);
  assert.equal(json.canSave, true);
  assert.equal(json.canSubmit, true);
  assert.deepEqual(json.validFieldIds, ["temperature_f"]);
  assert.deepEqual(json.unvalidatedFieldIds, []);
  assert.equal(json.fields.temperature_f.validationState, "valid");
  assert.equal(
    json.fields.temperature_f.validationRowResults[0].calculatedValue,
    100
  );

  const viaPayload = evaluateRecordPayload(plan, {
    formId: "json-contract",
    formVersion: 3,
    values: { temperature_f: 212 }
  });
  assert.deepEqual(viaPayload, json);

  assert.throws(
    () =>
      evaluateRecordPayload(plan, {
        formId: "json-contract",
        formVersion: 4,
        values: { temperature_f: 212 }
      }),
    /compiled plan is json-contract version 3/i
  );
});

test("Checkbox selection guidance preserves explicit Any/All semantics", () => {
  const plan = compileForm({
    formId: "checkbox-guidance",
    version: 1,
    fields: [
      {
        id: "choices",
        label: "Choices",
        valueType: "string",
        validationRows: [
          {
            id: "req",
            criteria: "selection_values_include_all",
            keyword: ["A", "B"]
          },
          {
            id: "forbid",
            operator: "AND",
            criteria: "selection_values_exclude_any",
            keyword: ["C", "D"]
          }
        ]
      }
    ]
  });
  const guidance = getFieldInputGuidance(plan, "choices");
  assert.equal(guidance.kind, "selection");
  assert.deepEqual(guidance.selectionRequirements, [
    { mode: "include_all", values: ["A", "B"], caseSensitive: false },
    { mode: "exclude_any", values: ["C", "D"], caseSensitive: false }
  ]);
  assert.match(guidance.display, /Select all of: A, B/);
  assert.match(guidance.display, /Do not select any of: C, D/);
});

test("definition validation rejects provably impossible Checkbox AND combinations", () => {
  const issues = validateFormDefinition({
    formId: "checkbox-conflict",
    version: 1,
    fields: [
      {
        id: "choices",
        label: "Choices",
        valueType: "string",
        validationRows: [
          {
            id: "req",
            criteria: "selection_values_include_all",
            keyword: ["A", "B"]
          },
          {
            id: "forbid",
            operator: "AND",
            criteria: "selection_values_exclude_any",
            keyword: ["B"]
          }
        ]
      }
    ]
  });
  assert.ok(
    issues.some((issue) => issue.code === "VR-X-SEL-REQUIRED-EXCLUDED")
  );
  assert.throws(
    () =>
      compileForm({
        formId: "checkbox-conflict",
        version: 1,
        fields: [
          {
            id: "choices",
            label: "Choices",
            valueType: "string",
            validationRows: [
              {
                id: "req",
                criteria: "selection_values_include_all",
                keyword: ["A", "B"]
              },
              {
                id: "forbid",
                operator: "AND",
                criteria: "selection_values_exclude_any",
                keyword: ["B"]
              }
            ]
          }
        ]
      }),
    /required value\(s\).*also excluded/i
  );
});

test("legacy scalar selection criteria remain compatible and map to ANY semantics", () => {
  const plan = compileForm({
    formId: "legacy-selection",
    version: 1,
    fields: [
      {
        id: "choice",
        label: "Choice",
        valueType: "string",
        validationRows: [
          { id: "r", criteria: "selection_values_include", keyword: ["A", "B"] }
        ]
      }
    ]
  });
  assert.equal(
    evaluateRecord(plan, new Map([["choice", "A"]])).values.get("choice")
      .validationPassed,
    true
  );
  assert.equal(
    evaluateRecord(plan, new Map([["choice", ["C", "B"]]])).values.get("choice")
      .validationPassed,
    true
  );
});

test("Checkbox selection edge cases treat BLANK as no selection and honor case sensitivity", () => {
  const insensitive = compileForm({
    formId: "sel-case-i",
    version: 1,
    fields: [
      {
        id: "c",
        label: "C",
        valueType: "string",
        validationRows: [
          {
            id: "r",
            criteria: "selection_values_include_any",
            keyword: ["Alpha"],
            caseSensitive: false
          }
        ]
      }
    ]
  });
  assert.equal(
    evaluateRecord(insensitive, new Map([["c", ["alpha"]]])).values.get("c")
      .validationPassed,
    true
  );
  assert.equal(
    evaluateRecord(insensitive, new Map([["c", null]])).values.get("c")
      .validationPassed,
    false
  );

  const sensitive = compileForm({
    formId: "sel-case-s",
    version: 1,
    fields: [
      {
        id: "c",
        label: "C",
        valueType: "string",
        validationRows: [
          {
            id: "r",
            criteria: "selection_values_include_any",
            keyword: ["Alpha"],
            caseSensitive: true
          }
        ]
      }
    ]
  });
  assert.equal(
    evaluateRecord(sensitive, new Map([["c", ["alpha"]]])).values.get("c")
      .validationPassed,
    false
  );
  assert.equal(
    evaluateRecord(sensitive, new Map([["c", ["Alpha"]]])).values.get("c")
      .validationPassed,
    true
  );
});

test("validation-row precedence exhaustively matches NOT > AND-family > OR-family semantics", () => {
  const operators = ["AND", "OR", "AND NOT", "OR NOT"];
  const dummy = (operator) => ({
    operator,
    criteria: "number_equal_to",
    keyword: 0,
    caseSensitive: false
  });
  const reference = (ops, values) => {
    const groups = [];
    let current = [values[0]];
    for (let i = 1; i < values.length; i++) {
      const op = ops[i - 1];
      const operand =
        op === "AND NOT" || op === "OR NOT" ? !values[i] : values[i];
      if (op === "OR" || op === "OR NOT") {
        groups.push(current);
        current = [operand];
      } else current.push(operand);
    }
    groups.push(current);
    return groups.some((group) => group.every(Boolean));
  };
  for (let n = 1; n <= 5; n++) {
    const opSlots = n - 1;
    const opCombos = 4 ** opSlots;
    for (let oi = 0; oi < opCombos; oi++) {
      let x = oi;
      const ops = [];
      for (let i = 0; i < opSlots; i++) {
        ops.push(operators[x % 4]);
        x = Math.floor(x / 4);
      }
      const rules = [dummy("AND"), ...ops.map(dummy)];
      for (let mask = 0; mask < 1 << n; mask++) {
        const values = Array.from({ length: n }, (_, i) => !!(mask & (1 << i)));
        assert.equal(
          combineValidationRowResults(rules, values),
          reference(ops, values),
          `n=${n} ops=${ops.join("|")} values=${values.join(",")}`
        );
      }
    }
  }
});

test("Checkbox Any/All criteria match set definitions for every subset of a small option universe", () => {
  const modes = {
    selection_values_include_any: (selected) =>
      selected.has("A") || selected.has("B"),
    selection_values_include_all: (selected) =>
      selected.has("A") && selected.has("B"),
    selection_values_exclude_any: (selected) =>
      !selected.has("A") && !selected.has("B"),
    selection_values_exclude_all: (selected) =>
      !(selected.has("A") && selected.has("B"))
  };
  const universe = ["A", "B", "C"];
  for (const [criteria, expected] of Object.entries(modes)) {
    const plan = compileForm({
      formId: `set-${criteria}`,
      version: 1,
      fields: [
        {
          id: "c",
          label: "C",
          valueType: "string",
          mustBeCorrect: true,
          validationRows: [{ id: "r", criteria, keyword: ["A", "B"] }]
        }
      ]
    });
    for (let mask = 0; mask < 1 << universe.length; mask++) {
      const selected = universe.filter((_, i) => mask & (1 << i));
      const result = evaluateRecord(
        plan,
        new Map([["c", selected]])
      ).values.get("c").validationPassed;
      assert.equal(
        result,
        expected(new Set(selected)),
        `${criteria}: ${selected.join(",")}`
      );
    }
  }
});

test("Include All plus Exclude Any expresses one exact Checkbox set over the defined option universe", () => {
  const universe = ["A", "B", "C", "D"];
  const plan = compileForm({
    formId: "exact-set-property",
    version: 1,
    fields: [
      {
        id: "c",
        label: "C",
        valueType: "string",
        mustBeCorrect: true,
        validationRows: [
          {
            id: "required",
            criteria: "selection_values_include_all",
            keyword: ["A", "B"]
          },
          {
            id: "others",
            operator: "AND",
            criteria: "selection_values_exclude_any",
            keyword: ["C", "D"]
          }
        ]
      }
    ]
  });
  for (let mask = 0; mask < 1 << universe.length; mask++) {
    const selected = universe.filter((_, i) => mask & (1 << i));
    const actual = evaluateRecord(plan, new Map([["c", selected]])).values.get(
      "c"
    ).validationPassed;
    assert.equal(
      actual,
      selected.length === 2 && selected.includes("A") && selected.includes("B"),
      selected.join(",")
    );
  }
});

test("definition validation rejects blank numeric thresholds and invalid character-limit counts", () => {
  const blank = validateFormDefinition({
    formId: "blank-num",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          { id: "r", criteria: "number_greater_than", keyword: "" }
        ]
      }
    ]
  });
  assert.ok(
    blank.some(
      (issue) => issue.code.startsWith("NUM-") && issue.severity === "error"
    )
  );
  assert.throws(
    () =>
      compileForm({
        formId: "blank-num",
        version: 1,
        fields: [
          {
            id: "x",
            label: "X",
            valueType: "number",
            validationRows: [
              { id: "r", criteria: "number_greater_than", keyword: "" }
            ]
          }
        ]
      }),
    /valid number/i
  );

  for (const bad of [-1, 1.5]) {
    const issues = validateFormDefinition({
      formId: `char-${bad}`,
      version: 1,
      fields: [
        {
          id: "x",
          label: "X",
          valueType: "string",
          validationRows: [
            { id: "r", criteria: "character_limit_less_than", keyword: bad }
          ]
        }
      ]
    });
    assert.ok(
      issues.some(
        (issue) =>
          issue.code.startsWith("CHAR-LIMIT-") && issue.severity === "error"
      )
    );
  }
});

test("definition validation catches equality/range contradictions without rejecting satisfiable boundaries", () => {
  const impossible = validateFormDefinition({
    formId: "eq-conflict",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          { id: "eq", criteria: "number_equal_to", keyword: 5 },
          {
            id: "gt",
            operator: "AND",
            criteria: "number_greater_than",
            keyword: 5
          }
        ]
      }
    ]
  });
  assert.ok(
    impossible.some((issue) => issue.code === "VR-X-NUM-EQUALITY-RANGE")
  );

  const possible = validateFormDefinition({
    formId: "eq-ok",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          { id: "eq", criteria: "number_equal_to", keyword: 5 },
          {
            id: "gt",
            operator: "AND",
            criteria: "number_greater_than",
            keyword: 4
          },
          {
            id: "lt",
            operator: "AND",
            criteria: "number_less_than",
            keyword: 6
          }
        ]
      }
    ]
  });
  assert.equal(
    possible.filter((issue) => issue.severity === "error").length,
    0
  );
});

test("case-insensitive duplicate selection values are warnings, not impossible-definition errors", () => {
  const issues = validateFormDefinition({
    formId: "selection-duplicates",
    version: 1,
    fields: [
      {
        id: "c",
        label: "C",
        valueType: "string",
        validationRows: [
          {
            id: "r",
            criteria: "selection_values_include_any",
            keyword: ["Alpha", "alpha"],
            caseSensitive: false
          }
        ]
      }
    ]
  });
  assert.ok(
    issues.some(
      (issue) =>
        issue.code.startsWith("SEL-DUP-") && issue.severity === "warning"
    )
  );
  assert.equal(issues.filter((issue) => issue.severity === "error").length, 0);
  assert.doesNotThrow(() =>
    compileForm({
      formId: "selection-duplicates",
      version: 1,
      fields: [
        {
          id: "c",
          label: "C",
          valueType: "string",
          validationRows: [
            {
              id: "r",
              criteria: "selection_values_include_any",
              keyword: ["Alpha", "alpha"],
              caseSensitive: false
            }
          ]
        }
      ]
    })
  );
});

test("validation-row source dependencies may be reciprocal because rows read one entered-value snapshot", () => {
  const plan = compileForm({
    formId: "reciprocal-row-reads",
    version: 1,
    fields: [
      {
        id: "a",
        label: "A",
        valueType: "number",
        validationRows: [
          {
            id: "ra",
            expression: '=FIELD("b")',
            criteria: "number_equal_to",
            keyword: 2
          }
        ]
      },
      {
        id: "b",
        label: "B",
        valueType: "number",
        validationRows: [
          {
            id: "rb",
            expression: '=FIELD("a")',
            criteria: "number_equal_to",
            keyword: 1
          }
        ]
      }
    ]
  });
  const result = evaluateRecord(
    plan,
    new Map([
      ["a", 1],
      ["b", 2]
    ])
  );
  assert.equal(result.canSubmit, true);
  assert.deepEqual([...affectedFields(plan, "a")].sort(), ["a", "b"]);
});

test("recursive legacy calculated-field chains still reject true calculation cycles", () => {
  assert.throws(
    () =>
      compileForm({
        formId: "legacy-cycle",
        version: 1,
        fields: [
          {
            id: "a",
            label: "A",
            valueType: "number",
            expression: '=FIELD("b")'
          },
          {
            id: "b",
            label: "B",
            valueType: "number",
            expression: '=FIELD("a")'
          }
        ]
      }),
    /Circular legacy calculated-field dependency/i
  );
});

test("runtime definition validation rejects unsupported value types, criteria, and row operators from untyped JSON", () => {
  const def = {
    formId: "bad-json",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "object",
        validationRows: [
          { id: "r", operator: "XOR", criteria: "bogus", keyword: "x" }
        ]
      }
    ]
  };
  const issues = validateFormDefinition(def);
  assert.ok(issues.some((issue) => issue.code === "FIELD-VALUE-TYPE"));
  assert.ok(issues.some((issue) => issue.code.startsWith("CRITERIA-")));
  // Criterion validation returns early because the criterion itself is unknown; either way compilation must reject.
  assert.throws(() => compileForm(def), /Form definition is invalid/i);
});
