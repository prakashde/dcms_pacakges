# ATLAS-SEL-003 - Exact Checkbox Set by Composition

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Use case

A controlled checklist offers four known options: `A`, `B`, `C`, and `D`. The acceptable Record must contain exactly `A` and `B`, with neither optional/other value selected.

DCMS does not need a fifth "Exact Set" criterion. Exactness is composed from the two orthogonal set rules already in the language.

## Validation rows

| Row | Operator | Criteria | Values |
|---:|---|---|---|
| 1 |  | Selection Values Include All | `A`, `B` |
| 2 | AND | Selection Values Exclude Any | `C`, `D` |

## Expected behavior

| Selected values | Result | Reason |
|---|---|---|
| `A, B` | PASS | all required values present and no other defined values selected |
| `A` | FAIL | `B` is missing |
| `A, B, C` | FAIL | `C` is explicitly excluded |
| `B, D` | FAIL | required `A` missing and `D` excluded |

## Architectural point

Exact-set behavior is derived from authored options. If the Form's option list changes, the authoring UI should help the author keep the "all other values" exclusion list current rather than adding a separate runtime semantic.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-SEL-003"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
function evalOneField(field, enteredValue) {
  const plan = compileForm({ formId: 'atlas', version: 1, fields: [field] });
  const result = evaluateRecord(plan, new Map([[field.id, enteredValue]]));
  return { result, field: result.values.get(field.id) };
}
const definition = {
  id: 'checkbox', label: 'Exact A+B', valueType: 'string', mustBeCorrect: true,
  validationRows: [
    { id: 'required', criteria: 'selection_values_include_all', keyword: ['A','B'] },
    { id: 'other', operator: 'AND', criteria: 'selection_values_exclude_any', keyword: ['C','D'] },
  ],
};
assert.equal(evalOneField(definition, ['A','B']).field.validationPassed, true);
assert.equal(evalOneField(definition, ['A']).field.validationPassed, false);
assert.equal(evalOneField(definition, ['A','B','C']).field.validationPassed, false);
assert.equal(evalOneField(definition, ['B','D']).field.validationPassed, false);
```
