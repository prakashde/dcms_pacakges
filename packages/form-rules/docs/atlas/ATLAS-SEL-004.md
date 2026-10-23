# ATLAS-SEL-004 - Checkbox Set Semantics and Input Immutability

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Use case

Imported or reconstructed Record data may contain duplicate checkbox values or a different array order from the UI. Validation should judge the selected set, not the array's incidental ordering or duplicate count.

## Rule

`Selection Values Include All: A, B`

## Example

Entered selection: `B, A, A`

Expected result: **PASS**.

The evaluator treats Checkbox selections as a set for comparison. The original entered array is not reordered, deduplicated, or otherwise mutated by validation.

## Architectural point

This protects both correctness and isolation: set normalization is local to the compiled/evaluation rule and cannot rewrite authoritative Record input supplied by React or Express.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-SEL-004"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
function evalOneField(field, enteredValue) {
  const plan = compileForm({ formId: 'atlas', version: 1, fields: [field] });
  const result = evaluateRecord(plan, new Map([[field.id, enteredValue]]));
  return { result, field: result.values.get(field.id) };
}
const selected = ['B','A','A'];
const before = structuredClone(selected);
const { field } = evalOneField({
  id: 'checkbox', label: 'Checkbox', valueType: 'string', mustBeCorrect: true,
  validationRows: [{ id: 'all', criteria: 'selection_values_include_all', keyword: ['A','B'] }],
}, selected);
assert.equal(field.validationPassed, true);
assert.deepEqual(selected, before);
```
