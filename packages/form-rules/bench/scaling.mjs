/** Scaling probe used to find where Form size/dependency fan-out could become a UI concern before adding limits. */
import { performance } from "node:perf_hooks";
import {
  affectedFields,
  compileForm,
  evaluateChange,
  evaluateRecord,
  getCompiledPlanStats
} from "../dist/esm/index.js";

function buildDefinition(fieldCount, rowsPerField = 10, dependencyStride = 0) {
  const fields = [];
  for (let i = 0; i < fieldCount; i++) {
    const id = `f_${String(i + 1).padStart(5, "0")}`;
    const dependency =
      dependencyStride > 0 && i > 0 && i % dependencyStride === 0
        ? "f_00001"
        : null;
    const validationRows = [];
    for (let r = 0; r < rowsPerField; r++) {
      validationRows.push({
        id: `${id}_vr_${r + 1}`,
        operator:
          r === 0
            ? undefined
            : r % 4 === 1
              ? "AND"
              : r % 4 === 2
                ? "OR"
                : r % 4 === 3
                  ? "AND NOT"
                  : "OR NOT",
        expression:
          dependency && r === 0
            ? `=VALUE + FIELD("${dependency}") * 0`
            : "=VALUE + 0",
        criteria: r % 2 === 0 ? "number_greater_than" : "number_less_than",
        keyword: r % 2 === 0 ? -1000000 : 1000000
      });
    }
    fields.push({
      id,
      label: `Field ${i + 1}`,
      valueType: "number",
      mustBeCorrect: i % 7 !== 0,
      validationRows
    });
  }
  return { formId: `scale-${fieldCount}x${rowsPerField}`, version: 1, fields };
}

function runCase(fieldCount, rowsPerField = 10, dependencyStride = 0) {
  const definition = buildDefinition(
    fieldCount,
    rowsPerField,
    dependencyStride
  );
  const t0 = performance.now();
  const plan = compileForm(definition);
  const compileMs = performance.now() - t0;
  const values = new Map(definition.fields.map((f, i) => [f.id, i + 1]));
  const f0 = performance.now();
  let result = evaluateRecord(plan, values);
  const fullMs = performance.now() - f0;
  const iterations = fieldCount <= 100 ? 3000 : fieldCount <= 500 ? 2000 : 1000;
  let totalIncremental = 0;
  let maxIncremental = 0;
  let maxAffected = 0;
  const ids = definition.fields.map((f) => f.id);
  for (let i = 0; i < iterations; i++) {
    const id = ids[i % ids.length];
    values.set(id, Number(values.get(id)) + 0.001);
    maxAffected = Math.max(maxAffected, affectedFields(plan, id).size);
    const x0 = performance.now();
    result = evaluateChange(plan, values, result, id);
    const elapsed = performance.now() - x0;
    totalIncremental += elapsed;
    maxIncremental = Math.max(maxIncremental, elapsed);
  }
  return {
    fieldCount,
    rowsPerField,
    dependencyStride,
    stats: getCompiledPlanStats(plan),
    compileMs: +compileMs.toFixed(3),
    fullEvaluationMs: +fullMs.toFixed(3),
    incrementalIterations: iterations,
    meanIncrementalMs: +(totalIncremental / iterations).toFixed(6),
    maxIncrementalMs: +maxIncremental.toFixed(3),
    maxAffectedFields: maxAffected,
    canSubmit: result.canSubmit
  };
}

const cases = [
  runCase(100, 10, 0),
  runCase(500, 10, 0),
  runCase(1000, 10, 0),
  runCase(1000, 10, 10)
];
console.log(JSON.stringify({ runtime: process.version, cases }, null, 2));
