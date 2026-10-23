/** Performance harness for representative compile/full/incremental workloads.
 * Benchmarks guard responsiveness decisions; they are not used to change validation semantics. */
import { performance } from "node:perf_hooks";
import {
  compileForm,
  evaluateChange,
  evaluateRecord
} from "../dist/esm/index.js";

function stats(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const pick = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  return {
    mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(4),
    p50: +pick(0.5).toFixed(4),
    p95: +pick(0.95).toFixed(4),
    max: +a[a.length - 1].toFixed(4)
  };
}
function makeDef(fieldCount, rulesPerField) {
  const fields = [];
  for (let i = 0; i < fieldCount; i++) {
    const expr =
      i % 10 === 0 && i > 0
        ? `=ROUND(MAX(VALUE, FIELD("f${i - 1}")) * 1.01, 3)`
        : i % 7 === 0
          ? "=UPPER(TRIM(TO_TEXT(VALUE)))"
          : i % 3 === 0
            ? "=ROUND(VALUE * 1.001, 3)"
            : null;
    const valueType = i % 7 === 0 ? "string" : "number";
    const validations = Array.from({ length: rulesPerField }, (_, r) =>
      valueType === "string"
        ? r % 2 === 0
          ? {
              criteria: "character_limit_less_than",
              keyword: 100,
              operator: "AND"
            }
          : {
              criteria: "required_keywords",
              keyword: "0 OR 1 OR 2 OR 3 OR 4 OR 5 OR 6 OR 7 OR 8 OR 9",
              operator: "OR"
            }
        : r % 2 === 0
          ? {
              criteria: "number_greater_than",
              keyword: -1000000,
              operator: "AND"
            }
          : { criteria: "number_less_than", keyword: 1000000, operator: "AND" }
    );
    fields.push({
      id: `f${i}`,
      label: `Field ${i}`,
      valueType,
      expression: expr,
      mustBeCorrect: false,
      validations
    });
  }
  return { formId: `bench-${fieldCount}`, version: 1, fields };
}
function runScenario(fieldCount, rulesPerField) {
  const def = makeDef(fieldCount, rulesPerField);
  const t0 = performance.now();
  const plan = compileForm(def);
  const compileMs = performance.now() - t0;
  const entered = new Map();
  for (let i = 0; i < fieldCount; i++)
    entered.set(`f${i}`, i % 7 === 0 ? String(i) : i + 0.5);
  const t1 = performance.now();
  let result = evaluateRecord(plan, entered);
  const firstFull = performance.now() - t1;
  const full = [];
  for (let i = 0; i < 200; i++) {
    const a = performance.now();
    result = evaluateRecord(plan, entered);
    full.push(performance.now() - a);
  }
  const inc = [];
  const changed = `f${Math.floor(fieldCount / 2)}`;
  for (let i = 0; i < 2000; i++) {
    entered.set(changed, (i % 7) + 100);
    const a = performance.now();
    result = evaluateChange(plan, entered, result, changed);
    inc.push(performance.now() - a);
  }
  return {
    fieldCount,
    validationRuleCount: fieldCount * rulesPerField,
    compileMs: +compileMs.toFixed(3),
    firstFullEvaluationMs: +firstFull.toFixed(3),
    fullEvaluationMs: stats(full),
    incrementalChangeMs: stats(inc),
    canSave: result.canSave,
    canSubmit: result.canSubmit
  };
}
const output = {
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  scenarios: [
    runScenario(100, 10),
    runScenario(250, 5),
    runScenario(500, 5),
    runScenario(1000, 5)
  ]
};
console.log(JSON.stringify(output, null, 2));
