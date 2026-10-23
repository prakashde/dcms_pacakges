/** Reference-scale regression tests for the 100 x 10 workload used in the prototype and performance evidence. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  compileForm,
  evaluateRecord,
  evaluateChange,
  getCompiledPlanStats,
  affectedFields
} from "../dist/esm/index.js";
import {
  buildPrototypeDefinition,
  buildInitialValues,
  buildAllValidValues
} from "../prototype/form-definition.mjs";

test("100-field prototype compiles 1,000 row formulas and 1,000 validations", () => {
  const { definition } = buildPrototypeDefinition();
  const stats = getCompiledPlanStats(compileForm(definition));
  assert.equal(stats.fieldCount, 100);
  assert.equal(stats.formulaCount, 1000);
  assert.equal(stats.validationRuleCount, 1000);
  assert.ok(stats.formulaInstructionCells > 1000);
});

test("prototype draft saves invalid data while submit blocks strict failures", () => {
  const { definition, meta } = buildPrototypeDefinition();
  const plan = compileForm(definition);
  const r = evaluateRecord(plan, buildInitialValues(meta));
  assert.equal(r.canSave, true);
  assert.equal(r.canSubmit, false);
  assert.ok(r.blockingFieldIds.length > 0);
  assert.ok(r.invalidFieldIds.length >= r.blockingFieldIds.length);
});

test("prototype submits after strict values are corrected", () => {
  const { definition, meta } = buildPrototypeDefinition();
  const plan = compileForm(definition);
  const r = evaluateRecord(plan, buildAllValidValues(meta));
  assert.equal(r.canSave, true);
  assert.equal(r.canSubmit, true);
});

test("incremental prototype evaluation touches only changed field and its dependents", () => {
  const { definition, meta } = buildPrototypeDefinition();
  const plan = compileForm(definition);
  const entered = buildAllValidValues(meta),
    previous = evaluateRecord(plan, entered);
  entered.set("temp_01", 500);
  const impacted = affectedFields(plan, "temp_01"),
    r = evaluateChange(plan, entered, previous, "temp_01");
  const expected = Array.from(
    { length: 10 },
    (_, i) => `temp_${String(i + 1).padStart(2, "0")}`
  );
  assert.deepEqual([...impacted].sort(), expected);
  assert.equal(r.values.size, 100);
  assert.equal(r.canSubmit, false);
  assert.equal(
    r.values.get("temp_01").validationRowResults[0].calculatedValue,
    260
  );
  for (const id of expected) {
    assert.equal(r.values.get(id).validationPassed, false, id);
    assert.notEqual(r.values.get(id), previous.values.get(id));
  }
  for (const id of plan.fieldOrder.filter((id) => !impacted.has(id)))
    assert.equal(
      r.values.get(id),
      previous.values.get(id),
      `${id} must be reused`
    );
});
