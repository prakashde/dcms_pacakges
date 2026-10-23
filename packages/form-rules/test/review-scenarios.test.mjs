/** Exact expected classifications prevent an extra warning/error from hiding behind a correct Submit flag. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as e from "../dist/esm/index.js";
for (const file of fs
  .readdirSync(new URL("../examples/scenarios/", import.meta.url))
  .filter((x) => x.endsWith(".json"))) {
  const s = JSON.parse(
    fs.readFileSync(
      new URL("../examples/scenarios/" + file, import.meta.url),
      "utf8"
    )
  );
  test(`S ${s.scenarioId} baseline and correction cases`, () => {
    const plan = e.compileForm(s.definition);
    for (const c of [
      { name: "baseline", patch: {}, canSubmit: s.expectedCanSubmit },
      ...s.cases
    ]) {
      const p = structuredClone(s.payload);
      Object.assign(p.values, c.patch);
      if ("externalReferences" in c)
        p.externalReferences = c.externalReferences;
      const r = e.evaluateRecordPayload(plan, p),
        errors = c.errors ?? [],
        blocking = [...new Set([...(c.blocking ?? []), ...errors])],
        warning = c.warning ?? [],
        invalid = [...new Set([...blocking, ...warning])];
      const valid = s.definition.fields
        .filter((f) => !invalid.includes(f.id))
        .map((f) => f.id);
      assert.equal(r.canSubmit, c.canSubmit, c.name);
      assert.equal(r.canSave, true, c.name);
      for (const [key, expected] of Object.entries({
        blockingFieldIds: blocking,
        warningFieldIds: warning,
        errorFieldIds: errors,
        invalidFieldIds: invalid,
        validFieldIds: valid,
        unvalidatedFieldIds: []
      }))
        assert.deepEqual(
          [...r[key]].sort(),
          [...expected].sort(),
          `${c.name}: ${key}`
        );
      for (const f of s.definition.fields) {
        const result = r.fields[f.id];
        assert.deepEqual(
          result.enteredValue,
          p.values[f.id],
          `${c.name}: source ${f.id}`
        );
        assert.equal(
          result.evaluationState,
          errors.includes(f.id) ? "error" : "ok"
        );
        assert.equal(
          result.validationState,
          errors.includes(f.id)
            ? null
            : blocking.includes(f.id)
              ? "blocking"
              : warning.includes(f.id)
                ? "warning"
                : "valid"
        );
      }
    }
  });
}
