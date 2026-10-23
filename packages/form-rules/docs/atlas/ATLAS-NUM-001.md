# ATLAS-NUM-001 — Simple numeric operating range

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

An assembly fastener must be tightened within a controlled torque range. No formula is required; both validation rows operate directly on the entered value.

## Field definition

| Property | Value |
|---|---|
| Field category | Number |
| Field label | Fastener Torque (N·m) |
| Entered value | `20` |
| Must Be Correct? | Yes |

## Validation rows

| Row | Operator | Optional Expression | Criteria | Criteria Value |
|---:|---|---|---|---:|
| 1 | — |  | Number Greater Than | `18` |
| 2 | AND |  | Number Less Than | `22` |

## Processing trace

```text
Row 1: 20 > 18  → TRUE
Row 2: 20 < 22  → TRUE

TRUE AND TRUE
= TRUE
```

The current criteria are strict comparisons. An entered value of exactly `18` does not satisfy **Greater Than 18**, and an entered value of exactly `22` does not satisfy **Less Than 22**.

## Record behavior

| Action | Expected result |
|---|---|
| Draft Save | Allowed |
| Submit | Allowed |
| UI indication | Normal |

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-NUM-001"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
function evalOneField(field, enteredValue) {
  const plan = compileForm({ formId: 'atlas', version: 1, fields: [field] });
  const result = evaluateRecord(plan, new Map([[field.id, enteredValue]]));
  return { result, field: result.values.get(field.id) };
}
const { result, field } = evalOneField({
  id: 'torque_nm',
  label: 'Fastener Torque (N·m)',
  valueType: 'number',
  mustBeCorrect: true,
  validationRows: [
    { id: 'min', criteria: 'number_greater_than', keyword: 18 },
    { id: 'max', operator: 'AND', criteria: 'number_less_than', keyword: 22 },
  ],
}, 20);

assert.deepEqual(field.validationRowResults.map(r => r.validationPassed), [true, true]);
assert.equal(field.validationPassed, true);
assert.equal(result.canSubmit, true);
```

Draft Save here describes the package's correction-draft behavior. Source requirement FR-REC-18 still needs reconciliation by the requirements owner; this example does not approve that application policy.
