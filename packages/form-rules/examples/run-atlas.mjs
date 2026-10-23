/** Execute the focused Atlas and compare realistic scenarios with explicitly authored expectations. */
import fs from "node:fs";
import assert from "node:assert/strict";
import { compileForm, evaluateRecordPayload } from "@dcms/form-rules";
let count = 0;
for (const file of fs
  .readdirSync(new URL("./atlas/", import.meta.url))
  .filter((x) => /^ATLAS-.*\.mjs$/.test(x))
  .sort()) {
  await import(new URL("./atlas/" + file, import.meta.url));
  console.log("PASS " + file);
  count++;
}
for (const file of fs
  .readdirSync(new URL("./scenarios/", import.meta.url))
  .filter((x) => x.endsWith(".json"))
  .sort()) {
  const scenario = JSON.parse(
    fs.readFileSync(new URL("./scenarios/" + file, import.meta.url), "utf8")
  );
  const plan = compileForm(scenario.definition);
  for (const c of [
    { name: "baseline", patch: {}, canSubmit: scenario.expectedCanSubmit },
    ...scenario.cases
  ]) {
    const payload = structuredClone(scenario.payload);
    Object.assign(payload.values, c.patch);
    if ("externalReferences" in c)
      payload.externalReferences = c.externalReferences;
    const result = evaluateRecordPayload(plan, payload);
    const errors = c.errors ?? [],
      blocking = [...new Set([...(c.blocking ?? []), ...errors])];
    const warning = c.warning ?? [],
      invalid = [...new Set([...blocking, ...warning])];
    const valid = scenario.definition.fields
      .filter((f) => !invalid.includes(f.id))
      .map((f) => f.id);
    assert.equal(result.canSubmit, c.canSubmit, `${file}: ${c.name}`);
    assert.equal(result.canSave, true);
    // Exact classifications detect extra failures that a single canSubmit check would miss.
    for (const [key, expected] of Object.entries({
      blockingFieldIds: blocking,
      warningFieldIds: warning,
      errorFieldIds: errors,
      invalidFieldIds: invalid,
      validFieldIds: valid,
      unvalidatedFieldIds: []
    })) {
      assert.deepEqual(
        [...result[key]].sort(),
        [...expected].sort(),
        `${file}: ${c.name}: ${key}`
      );
    }
    for (const definition of scenario.definition.fields) {
      const field = result.fields[definition.id];
      assert.deepEqual(field.enteredValue, payload.values[definition.id]);
      assert.equal(
        field.evaluationState,
        errors.includes(definition.id) ? "error" : "ok"
      );
      assert.equal(
        field.validationState,
        errors.includes(definition.id)
          ? null
          : blocking.includes(definition.id)
            ? "blocking"
            : warning.includes(definition.id)
              ? "warning"
              : "valid"
      );
    }
  }
  console.log("PASS " + file + ` (${scenario.cases.length + 1} inputs)`);
  count++;
}
assert.equal(
  count,
  18,
  "The delivered Atlas must contain all fourteen cases and four scenarios."
);
console.log(`${count} Atlas examples passed.`);
