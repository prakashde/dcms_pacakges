/** Qualification benchmark for the agreed 100-field x 10-validation-row reference workload. */
import { performance } from "node:perf_hooks";
import {
  affectedFields,
  compileForm,
  evaluateChange,
  evaluateRecord,
  getCompiledPlanStats
} from "../dist/esm/index.js";
import {
  buildAllValidValues,
  buildKnownFailureValues,
  buildPrototypeDefinition
} from "../prototype/form-definition.mjs";

const { definition, meta } = buildPrototypeDefinition();
const c0 = performance.now();
const plan = compileForm(definition);
const c1 = performance.now();
const stats = getCompiledPlanStats(plan);
const values = buildAllValidValues(meta);
const f0 = performance.now();
let result = evaluateRecord(plan, values);
const f1 = performance.now();
const ids = [...values.keys()].filter(
  (id) => typeof values.get(id) === "number"
);
let total = 0;
let maxAffected = 0;
const iterations = 5000;
for (let i = 0; i < iterations; i++) {
  const id = ids[i % ids.length];
  values.set(id, Number(values.get(id)) + 0.0001);
  maxAffected = Math.max(maxAffected, affectedFields(plan, id).size);
  const t0 = performance.now();
  result = evaluateChange(plan, values, result, id);
  total += performance.now() - t0;
}
const failureValues = buildKnownFailureValues(meta);
const x0 = performance.now();
const failureResult = evaluateRecord(plan, failureValues);
const x1 = performance.now();
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      stats,
      compileMs: +(c1 - c0).toFixed(3),
      firstFullEvaluationMs: +(f1 - f0).toFixed(3),
      incrementalIterations: iterations,
      meanIncrementalMs: +(total / iterations).toFixed(6),
      maxAffectedFields: maxAffected,
      allValid: {
        canSave: result.canSave,
        canSubmit: result.canSubmit,
        invalidFields: result.invalidFieldIds.length
      },
      knownFailures: {
        canSave: failureResult.canSave,
        canSubmit: failureResult.canSubmit,
        invalidFields: failureResult.invalidFieldIds.length,
        blockingFields: failureResult.blockingFieldIds.length,
        warningFields: failureResult.warningFieldIds.length,
        fullEvaluationMs: +(x1 - x0).toFixed(3)
      }
    },
    null,
    2
  )
);
