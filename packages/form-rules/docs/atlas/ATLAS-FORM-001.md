# ATLAS-FORM-001 — Fahrenheit input converted before Celsius validation

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

A process-temperature field is entered in degrees Fahrenheit, but the acceptance limit is maintained in degrees Celsius. The Optional Expression converts the entered value before the numeric criterion is applied.

## Field definition

| Property | Value |
|---|---|
| Field category | Number |
| Field label | Process Temperature °F |
| Entered value | `212` |
| Must Be Correct? | Yes |

## Validation row

| Operator | Optional Expression | Criteria | Keyword / Criteria Value | Case Sensitive |
|---|---|---|---:|---|
| — | `=ROUND((VALUE-32)*5/9,1)` | Number Less Than | `105` | N/A |

## Processing trace

```text
Entered VALUE = 212
       ↓
=ROUND((VALUE-32)*5/9,1)
       ↓
100
       ↓
100 < 105
       ↓
TRUE
```

The expression result belongs to this validation row. It does not replace the stored entered value.

## Record behavior

| Action | Expected result |
|---|---|
| Draft Save | Allowed |
| Submit | Allowed |
| UI indication | Normal |

## Why this example matters

This is the basic DCMS processing order: **entered value → optional row expression → criterion → Boolean row result**.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-FORM-001"} -->
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
  id: 'process_temp_f',
  label: 'Process Temperature °F',
  valueType: 'number',
  mustBeCorrect: true,
  validationRows: [
    {
      id: 'celsius_limit',
      expression: '=ROUND((VALUE-32)*5/9,1)',
      criteria: 'number_less_than',
      keyword: 105,
    },
  ],
}, 212);

assert.equal(field.enteredValue, 212);
assert.equal(field.validationRowResults[0].calculatedValue, 100);
assert.equal(field.validationPassed, true);
assert.equal(result.canSave, true);
assert.equal(result.canSubmit, true);
```

Draft Save here describes the package's correction-draft behavior. Source requirement FR-REC-18 still needs reconciliation by the requirements owner; this example does not approve that application policy.
