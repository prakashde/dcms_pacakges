# DCMS runtime value semantics

Applies to the shipped 0.10.5 source and current runtime-value assertions.

The controlled runtime types are:

- NUMBER — JavaScript IEEE-754 binary64 finite `number`
- STRING
- BOOLEAN
- BLANK — represented internally by `null`
- ARRAY — arrays of DCMS runtime values
- ERROR — represented by `DcmsRuleError`; errors are not ordinary formula values
- DATE — not enabled until DCMS date semantics are approved

## BLANK

BLANK is descriptive notation for the JavaScript/JSON value `null`; it is not a formula literal. In executable examples, use `VALUE` with `{value:null}` or a field whose entered value is null. For example, `COALESCE(VALUE,"fallback")` returns `"fallback"` for a null input.

BLANK is distinct from `0`, `false`, and `""`. The initial DCMS rules are intentionally conservative:

| Operation | Result |
|---|---|
| `BLANK = BLANK` | `TRUE` |
| `BLANK = 0` | `FALSE` |
| `BLANK = ""` | `FALSE` |
| `BLANK & "A"` | `"A"` |
| arithmetic such as `BLANK + 5` | controlled `FORMULA_EXPECTED_NUMBER` error |
| native Boolean use such as `BLANK AND TRUE` | controlled `FORMULA_EXPECTED_BOOLEAN` error |

Formula.js functions are called through the DCMS registry. BLANK is passed as `null`; the pinned Formula.js behavior is accepted only for functions that are exposed by the registry. The corresponding runtime-value test cases include `SUM(BLANK,5) = 5`, `MAX(BLANK,5) = 5`, `ISBLANK(BLANK) = TRUE`, and `LEN(BLANK) = 0`.

## Numbers

DCMS formula numbers are finite JavaScript `Number` values (IEEE-754 binary64). `NaN`, `Infinity`, and `-Infinity` are not valid calculated results and are normalized to controlled formula errors. Division by zero is a dedicated `FORMULA_DIV_ZERO` error.

These semantics are owned by DCMS and are compatibility-tested. Formula.js or JavaScript coercion rules do not automatically redefine them.

## Runtime boundaries

Native equality treats negative and positive zero as equal. Non-finite literals are rejected during preparation. Object values, functions, undefined, sparse arrays and excessive nesting are rejected at the JSON/runtime boundary. UTF-16 code units are the unit for string length and character budgets. Definition valueType is metadata for the host control; field criteria decide correctness. The engine does not enforce a separate mandatory-field or application selection-option catalogue.
