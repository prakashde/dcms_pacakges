# ATLAS-EDGE-001 — Composite row operators use NOT > AND > OR precedence

**Status:** Qualified  
**Qualified against:** `@dcms/form-rules` v0.10.3, the executable block below and `test/atlas.test.mjs`

## Scenario

Each Validation Rule row is evaluated independently to TRUE/FALSE. The Operator column then forms one Boolean expression for that field. `NOT` applies to the current row operand, `AND` / `AND NOT` bind before `OR` / `OR NOT`, and the first row starts the first AND group.

This example uses:

```text
Row 1 = A
Row 2 = B, operator OR
Row 3 = C, operator AND NOT
```

The controlled meaning is:

```text
A OR (B AND NOT C)
```

## Truth table

| A | B | C | `B AND NOT C` | Final `A OR (B AND NOT C)` |
|---|---|---|---|---|
| FALSE | FALSE | FALSE | FALSE | FALSE |
| FALSE | FALSE | TRUE  | FALSE | FALSE |
| FALSE | TRUE  | FALSE | TRUE  | TRUE  |
| FALSE | TRUE  | TRUE  | FALSE | FALSE |
| TRUE  | FALSE | FALSE | FALSE | TRUE  |
| TRUE  | FALSE | TRUE  | FALSE | TRUE  |
| TRUE  | TRUE  | FALSE | TRUE  | TRUE  |
| TRUE  | TRUE  | TRUE  | FALSE | TRUE  |

For `A=TRUE`, `B=FALSE`, `C=TRUE`, the result is TRUE because the leading OR group is already TRUE; the later `AND NOT` belongs to the B group rather than being applied to the accumulated OR result.

## OR NOT example

```text
A
OR NOT B
AND C
```

means:

```text
A OR ((NOT B) AND C)
```

## Isolation rule

The precedence rule combines row Boolean outputs only. Each row still evaluates from the same field source value and cannot mutate another row or field. An explicit `FIELD("id")` reference is read-only and only establishes a dependency for reevaluation.

## First-row rule

The first row has no preceding operator. The UI should display its Operator as blank/disabled.

## Executable example

Run this JavaScript with the installed package. Assertions check the stated results; a successful run exits without output.

<!-- dcms-example {"id":"ATLAS-EDGE-001"} -->
```js
import assert from 'node:assert/strict';
import { combineValidationRowResults, compileForm, diagnoseKeywordExpression,
  evaluateKeyword, evaluateRecord, parseKeywordExpression } from '@dcms/form-rules';
const rules = [
  { operator: 'AND', criteria: 'number_equal_to', keyword: 1, caseSensitive: false },
  { operator: 'OR', criteria: 'number_equal_to', keyword: 1, caseSensitive: false },
  { operator: 'AND NOT', criteria: 'number_equal_to', keyword: 1, caseSensitive: false },
];
// A OR B AND NOT C => A OR (B AND (NOT C)).
const expected = [
  [false, false, false, false],
  [false, false, true,  false],
  [false, true,  false, true],
  [false, true,  true,  false],
  [true,  false, false, true],
  [true,  false, true,  true],
  [true,  true,  false, true],
  [true,  true,  true,  true],
];

for (const [a, b, c, final] of expected) {
  assert.equal(combineValidationRowResults(rules, [a, b, c]), final, `${a},${b},${c}`);
}

assert.equal(combineValidationRowResults(rules, [true, false, true]), true);
```
