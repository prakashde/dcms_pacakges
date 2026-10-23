/** The failure policy controls Submit; canSave is the engine's correction-draft signal. */
import assert from "node:assert/strict";
import { makeField, evaluate } from "./helpers.mjs";
for (const mandatory of [false, true]) {
  const definition = makeField(
    [{ id: "maximum", criteria: "number_less_than", keyword: 100 }],
    mandatory
  );
  const { result, field } = evaluate(definition, 110);
  assert.equal(field.validationState, mandatory ? "blocking" : "warning");
  assert.equal(result.canSubmit, !mandatory);
  assert.equal(result.canSave, true);
  assert.equal(evaluate(definition, 90).field.validationState, "valid");
}
