# ATLAS-TEXT-001 — Normalize entered text before keyword validation

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

An operator enters a lot code with extra spaces and lowercase characters. The validation rule should evaluate a normalized value without replacing the operator's original entry. The Optional Expression trims the text and converts it to uppercase before Required Keywords is applied.

## Field definition

| Property | Value |
|---|---|
| Field category | Text |
| Field label | Lot Code |
| Entered value | `  lot-123  ` |
| Must Be Correct? | Yes |

## Validation modal definition

| Row | Operator | Optional Expression | Criteria | Keyword / Criteria Value | Case Sensitive |
|---:|---|---|---|---|---|
| 1 | — | `=UPPER(TRIM(VALUE))` | Required Keywords | `LOT-123` | Yes |

## Processing trace

```text
Entered VALUE = "  lot-123  "
        ↓
TRIM(VALUE)
        ↓
"lot-123"
        ↓
UPPER(...)
        ↓
"LOT-123"
        ↓
Required Keywords: LOT-123
        ↓
TRUE
```

The entered value remains `  lot-123  `. The calculated row value is `LOT-123` and is used only for this validation row.

## Record behavior

| Action | Expected result |
|---|---|
| Draft Save | Allowed |
| Submit | Allowed |
| UI indication | Normal |

## Parser/evaluator path

- Formula parser: Yes.
- Formula.js registry: `TRIM`, `UPPER`.
- Required Keywords parser: Yes.
- Validation criterion evaluator: Required Keywords.
- Row-combination evaluator: Not needed for one row.

## Why this example matters

It shows that text normalization belongs in the row's Optional Expression and happens before validation. It also shows that the calculated row value does not overwrite the raw operator entry.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-TEXT-001"} -->
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
  id: 'lot_code',
  label: 'Lot Code',
  valueType: 'string',
  mustBeCorrect: true,
  validationRows: [
    {
      id: 'normalized_lot',
      expression: '=UPPER(TRIM(VALUE))',
      criteria: 'required_keywords',
      keyword: 'LOT-123',
      caseSensitive: true,
    },
  ],
}, '  lot-123  ');

assert.equal(field.enteredValue, '  lot-123  ');
assert.equal(field.validationRowResults[0].calculatedValue, 'LOT-123');
assert.equal(field.validationPassed, true);
assert.equal(result.canSubmit, true);
```

Draft Save here describes the package's correction-draft behavior. Source requirement FR-REC-18 still needs reconciliation by the requirements owner; this example does not approve that application policy.
