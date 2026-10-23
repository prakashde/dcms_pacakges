# ATLAS-COMP-001 — Composite numeric validation with a per-row conversion

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

An operator enters a temperature in degrees Fahrenheit. One validation row converts the entered value to Celsius before checking a Celsius limit. Other rows check the source value directly. The example demonstrates that each validation row can have its own Optional Expression and that row Boolean results are combined separately from formula parsing.

## Field definition

| Property | Value |
|---|---|
| Field category | Number |
| Field label | Process Temperature °F |
| Entered value | `212` |
| Must Be Correct? | Yes |

## Validation modal definition

| Row | Operator | Optional Expression | Criteria | Keyword / Criteria Value | Case Sensitive |
|---:|---|---|---|---:|---|
| 1 | — |  | Number Greater Than | `180` | N/A |
| 2 | AND | `=(VALUE-32)*5/9` | Number Less Than | `105` | N/A |
| 3 | AND NOT |  | Number Equal To | `999` | N/A |

## Processing trace

| Row | Source VALUE | Expression result | Criterion evaluation | Row result |
|---:|---:|---:|---|---|
| 1 | `212` | `212` | `212 > 180` | TRUE |
| 2 | `212` | `100` | `100 < 105` | TRUE |
| 3 | `212` | `212` | `212 = 999` | FALSE |

The row-combination layer applies NOT > AND > OR precedence. Because this example contains only AND-family operators, the visible sequence is also the effective AND group:

```text
Row1 AND Row2 AND NOT Row3
TRUE AND TRUE AND NOT FALSE
= TRUE
```

The formula in Row 2 is parsed/evaluated by the formula engine. The `AND` / `AND NOT` row operators are not part of that formula; they belong to the validation-row combination layer.

## Record behavior

| Action | Expected result |
|---|---|
| Draft Save | Allowed |
| Submit | Allowed because the composite field result is TRUE |
| UI indication | Normal |

If Row 2 failed, Draft Save would remain allowed. Because Must Be Correct is Yes, Submit would be blocked.

## Parser/evaluator path

- Formula parser: Yes, Row 2 only.
- Required Keywords parser: No.
- Formula.js registry: Not required for this arithmetic-only conversion.
- Validation criterion evaluator: Number Greater Than, Number Less Than, Number Equal To.
- Row-combination evaluator: `AND`, then `AND NOT`.

## Notes

`=(VALUE-32)*5/9` is Fahrenheit → Celsius. The reverse conversion is `=VALUE*9/5+32`.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-COMP-001"} -->
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
    { id: 'source_min', criteria: 'number_greater_than', keyword: 180 },
    { id: 'c_max', operator: 'AND', expression: '=(VALUE-32)*5/9', criteria: 'number_less_than', keyword: 105 },
    { id: 'sentinel', operator: 'AND NOT', criteria: 'number_equal_to', keyword: 999 },
  ],
}, 212);

assert.deepEqual(field.validationRowResults.map(r => r.validationPassed), [true, true, false]);
assert.equal(field.validationRowResults[1].calculatedValue, 100);
assert.equal(field.validationPassed, true);
assert.equal(result.canSubmit, true);
```

Draft Save here describes the package's correction-draft behavior. Source requirement FR-REC-18 still needs reconciliation by the requirements owner; this example does not approve that application policy.
