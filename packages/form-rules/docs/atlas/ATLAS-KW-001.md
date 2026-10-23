# ATLAS-KW-001 — Implicit OR in Required Keywords

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

An inspection comment is acceptable when it contains either `PASS` or `ACCEPTABLE`. To remain congruent with DCMS table search, adjacent terms are treated as implicit `OR`.

## Validation row

| Property | Value |
|---|---|
| Criteria | Required Keywords |
| Keyword expression | `PASS ACCEPTABLE` |
| Case Sensitive | No |

## Normalized meaning

```text
PASS ACCEPTABLE
```

is interpreted as:

```text
PASS OR ACCEPTABLE
```

Examples:

| Entered text | Result |
|---|---|
| `Inspection result: PASS` | TRUE |
| `Inspection result: ACCEPTABLE` | TRUE |
| `Inspection result: FAIL` | FALSE |

## Authoring warning

The rule is valid, but the editor should show the non-blocking warning:

> Spaces between search terms are treated as OR. Use AND to require all terms.

The warning explains the implicit behavior; it does not prevent the validation rule from being confirmed.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-KW-001"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
const diagnostic = diagnoseKeywordExpression('PASS ACCEPTABLE');
assert.equal(diagnostic.state, 'valid');
assert.ok(diagnostic.warnings?.some(w => w.code === 'KEYWORD_IMPLICIT_OR'));

const ast = parseKeywordExpression('PASS ACCEPTABLE');
assert.equal(evaluateKeyword(ast, 'Inspection result: ACCEPTABLE', false), true);
assert.equal(evaluateKeyword(ast, 'Inspection result: FAIL', false), false);
```
