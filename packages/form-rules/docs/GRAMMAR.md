# DCMS Grammar v1.1

## Formula grammar

Chevrotain parses formulas. Function calls use one generic rule: `FunctionName(argumentList?)`. Functions such as `SUM`, `ROUND`, `NORM.DIST`, and `PMT` are registry data, not grammar productions.

Supported syntax includes literals, references, parentheses, `+ - * / ^ &`, comparisons `= <> != < <= > >=`, native `NOT`, `AND`, `OR`, and generic function calls. A leading formula `=` is accepted. Strings use Excel-style doubled quotes.

Precedence: parentheses/function calls; power/unary; multiply/divide; add/subtract; concatenation; comparisons; NOT; AND; OR as encoded by the controlled parser.

## Required Keywords grammar

A separate Chevrotain parser handles keyword terms, quoted literals, parentheses, uppercase `NOT`, `AND`, `OR`, and implicit OR between adjacent expressions. Required Keywords performs literal substring matching; it does not expose a user-authored regular-expression language.

Formula syntax and Required Keywords syntax are intentionally separate even though both use Chevrotain.


## Long phrase / paragraph matching

Quoted Required Keywords literals may contain long phrases or paragraph-sized text within the controlled limits contract. The parser treats punctuation and characters such as `.`, `*`, `+`, `?`, `[`, and `]` as literal content when they occur in a keyword literal; they do not gain regular-expression meaning.

Example:

```text
"The equipment shall remain within the validated operating range."
AND
("APPROVED" OR "ACCEPTABLE")
```

The rule is parsed once. Record-entry evaluation searches the entered text using literal substring matching.

## Required Keywords v2.1 — implicit OR and case-sensitive operators

Required Keywords intentionally follows the search behavior used elsewhere in DCMS:

- `AND`, `OR`, and `NOT` are logical operators only when entered in uppercase.
- Adjacent expressions separated by whitespace use **implicit OR**.
- Implicit OR has the same precedence as explicit `OR`.
- Precedence remains `NOT` > `AND` > `OR`.
- Quoted phrases remain one literal.
- Implicit OR is valid, but authoring diagnostics return a non-blocking warning so the UI can explain the behavior.
- Lowercase or mixed-case words such as `and`, `Or`, or `not` are literals, not operators. Diagnostics return a non-blocking case warning because the user may have intended an operator.

Examples:

```text
ABC DEF
```

means:

```text
ABC OR DEF
```

```text
ABC DEF AND XYZ
```

means:

```text
ABC OR (DEF AND XYZ)
```

```text
"Pass Fail" ABC
```

means:

```text
"Pass Fail" OR ABC
```

```text
ABC and DEF
```

is valid and means approximately:

```text
ABC OR "and" OR DEF
```

The authoring UI should show a warning such as:

> Operators are case-sensitive. `and` is being treated as a keyword; use AND, OR, or NOT in uppercase for operators.

For implicit OR, show:

> Spaces between search terms are treated as OR. Use AND to require all terms.

These warnings do not block saving the validation-rule definition.

## Keyword operator boundaries

In 2.1, operators occupy a complete token. `OR-HOLD` and `AND-READY` are literal terms. Operator-like words embedded in identifiers do not split into operators. Deep NOT chains produce a controlled limit error.
