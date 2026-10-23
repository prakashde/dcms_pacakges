# ATLAS-SAVE-001 — Draft Save versus Submit when validation fails

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

Two pressure fields use the same maximum-value rule and both contain an invalid value. One field has **Must Be Correct? = Yes**; the other does not.

## Field definitions

| Field | Entered value | Validation | Must Be Correct? |
|---|---:|---|---|
| Pressure — strict | `110` | Number Less Than `100` | Yes |
| Pressure — warning only | `110` | Number Less Than `100` | No |

Both validation rules fail.

## Record result

| Result | Expected behavior |
|---|---|
| Draft Save | **Allowed** |
| Strict field | Blocking validation state (evaluation succeeded) |
| Warning-only field | Warning state |
| Submit | **Blocked** because the strict field failed |

If only the warning-only field failed, Submit would remain allowed.

## Important distinction

This example concerns a **valid validation definition that fails against Record data**. A malformed formula or malformed Required Keywords definition is invalid Form configuration and must be corrected before that rule definition is confirmed/saved.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-SAVE-001"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
const plan = compileForm({
  formId: 'atlas-save',
  version: 1,
  fields: [
    {
      id: 'strict_pressure',
      label: 'Pressure — strict',
      valueType: 'number',
      mustBeCorrect: true,
      validationRows: [{ id: 'max', criteria: 'number_less_than', keyword: 100 }],
    },
    {
      id: 'warn_pressure',
      label: 'Pressure — warning only',
      valueType: 'number',
      mustBeCorrect: false,
      validationRows: [{ id: 'max', criteria: 'number_less_than', keyword: 100 }],
    },
  ],
});

const result = evaluateRecord(plan, new Map([
  ['strict_pressure', 110],
  ['warn_pressure', 110],
]));

assert.equal(result.canSave, true);
assert.equal(result.canSubmit, false);
assert.deepEqual(result.blockingFieldIds, ['strict_pressure']);
assert.deepEqual(result.warningFieldIds, ['warn_pressure']);
```

Draft Save here describes the package's correction-draft behavior. Source requirement FR-REC-18 still needs reconciliation by the requirements owner; this example does not approve that application policy.
