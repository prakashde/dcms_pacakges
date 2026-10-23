# ATLAS-SEL-001 — Radio selection allowed-list and excluded-list validation

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

A disposition Radio field may be submitted only when its value is one of the accepted outcomes and is not one of the blocked outcomes. This example qualifies both Selection Values Include and Selection Values Exclude for a single selected string value.

## Field definition

| Property | Value |
|---|---|
| Field category | Radio |
| Field label | Inspection Disposition |
| Entered value | `PASS` |
| Must Be Correct? | Yes |

## Validation modal definition

| Row | Operator | Optional Expression | Criteria | Keyword / Criteria Value | Case Sensitive |
|---:|---|---|---|---|---|
| 1 | — |  | Selection Values Include | `PASS`, `ACCEPTABLE` | No |
| 2 | AND |  | Selection Values Exclude | `HOLD`, `REJECT` | No |

## Processing trace

| Row | Source VALUE | Expression result | Criterion evaluation | Row result |
|---:|---|---|---|---|
| 1 | `PASS` | `PASS` | `PASS` is in `[PASS, ACCEPTABLE]` | TRUE |
| 2 | `PASS` | `PASS` | `PASS` is not in `[HOLD, REJECT]` | TRUE |

```text
Row1 AND Row2
TRUE AND TRUE
= TRUE
```

## Record behavior

| Action | Expected result |
|---|---|
| Draft Save | Allowed |
| Submit | Allowed |
| UI indication | Normal |

## Parser/evaluator path

- Formula parser: No.
- Required Keywords parser: No.
- Validation criterion evaluator: Selection Values Include and Selection Values Exclude.
- Row-combination evaluator: `AND`.

## Scope note

This example qualifies **Radio / single-string selection** semantics. Checkbox set semantics are qualified separately in `ATLAS-SEL-002` so scalar and multi-selection behavior are not conflated.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-SEL-001"} -->
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
  id: 'disposition',
  label: 'Inspection Disposition',
  valueType: 'string',
  mustBeCorrect: true,
  validationRows: [
    {
      id: 'allowed',
      criteria: 'selection_values_include',
      keyword: ['PASS', 'ACCEPTABLE'],
      caseSensitive: false,
    },
    {
      id: 'blocked',
      operator: 'AND',
      criteria: 'selection_values_exclude',
      keyword: ['HOLD', 'REJECT'],
      caseSensitive: false,
    },
  ],
}, 'PASS');

assert.deepEqual(field.validationRowResults.map(r => r.validationPassed), [true, true]);
assert.equal(field.validationPassed, true);
assert.equal(result.canSubmit, true);
```

Draft Save here describes the package's correction-draft behavior. Source requirement FR-REC-18 still needs reconciliation by the requirements owner; this example does not approve that application policy.
