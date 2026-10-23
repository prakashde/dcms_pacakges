# ATLAS-SEL-002 - Checkbox Include/Exclude Any/All

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Use case

A controlled-record Checkbox field may allow more than one selected option. The authored rule must say whether **any** configured value or **all** configured values matter; the runtime must not infer that intent.

Available options:

```text
A, B, C, D
```

The exact accepted selection is A+B.

## Authored validation rows

| Row | Operator | Criteria | Values |
|---:|---|---|---|
| 1 | - | Selection Values Include All | A, B |
| 2 | AND | Selection Values Exclude Any | C, D |

This means:

```text
(all of A and B are selected)
AND
(none of C or D are selected)
```

## Expected results

| Selected values | Result | Reason |
|---|---|---|
| A+B | PASS | all required values present; no excluded value selected |
| A | FAIL | B is missing |
| A+B+C | FAIL | C is excluded |
| B+D | FAIL | A is missing and D is excluded |

## Four Checkbox criteria

- **Include Any** - at least one configured value must be selected.
- **Include All** - every configured value must be selected; other values may also be selected.
- **Exclude Any** - none of the configured values may be selected.
- **Exclude All** - the complete configured combination may not be selected together.

## Edge behavior

Checkbox values are set-like. Order and duplicate selected values do not change the result. BLANK/null means no selection. Case Sensitive controls text comparison.

The package can reject a direct AND-only definition that is provably impossible, such as `Include All [A,B]` together with `Exclude Any [B]`. It does not attempt unsafe conflict inference through OR/NOT or formula-transformed rows.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-SEL-002"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
function evalOneField(field, enteredValue) {
  const plan = compileForm({ formId: 'atlas', version: 1, fields: [field] });
  const result = evaluateRecord(plan, new Map([[field.id, enteredValue]]));
  return { result, field: result.values.get(field.id) };
}
const cases = [
  ['selection_values_include_any', ['A'], true],
  ['selection_values_include_any', ['C'], false],
  ['selection_values_include_all', ['A','B'], true],
  ['selection_values_include_all', ['A'], false],
  ['selection_values_exclude_any', ['C'], true],
  ['selection_values_exclude_any', ['A','C'], false],
  ['selection_values_exclude_all', ['A'], true],
  ['selection_values_exclude_all', ['A','B'], false],
];

for (const [criteria, selected, expected] of cases) {
  const { field } = evalOneField({
    id: 'checkbox', label: 'Checkbox', valueType: 'string', mustBeCorrect: true,
    validationRows: [{ id: 'rule', criteria, keyword: ['A','B'] }],
  }, selected);
  assert.equal(field.validationPassed, expected, `${criteria} with ${selected.join(',')}`);
}
```
