# ATLAS-KW-002 — Explicit Required Keywords logic with grouping and NOT

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

A grounding verification note must mention `GROUND`, must mention either `STUD` or `STRAP`, and must not contain `MISSING`.

## Validation row

| Property | Value |
|---|---|
| Criteria | Required Keywords |
| Keyword expression | `GROUND AND (STUD OR STRAP) AND NOT MISSING` |
| Case Sensitive | No |

## Processing examples

| Entered text | Result | Why |
|---|---|---|
| `Ground stud installed` | TRUE | `GROUND` and `STUD` present; `MISSING` absent |
| `Ground strap installed but missing label` | FALSE | `NOT MISSING` fails |
| `Ground only` | FALSE | neither `STUD` nor `STRAP` present |

## Operator rules

Required Keywords operators are uppercase and case-sensitive:

```text
NOT > AND > OR
```

Lowercase or mixed-case `and`, `or`, and `not` are treated as search literals and should produce an authoring warning when they appear to be intended as operators.

This logic is entirely inside one Required Keywords row. It is separate from the Validation modal's row-to-row Operator column.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-KW-002"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
const ast = parseKeywordExpression('GROUND AND (STUD OR STRAP) AND NOT MISSING');
assert.equal(evaluateKeyword(ast, 'Ground stud installed', false), true);
assert.equal(evaluateKeyword(ast, 'Ground strap installed but missing label', false), false);
assert.equal(evaluateKeyword(ast, 'Ground only', false), false);
```
