# Definitions and value contracts

API and implementation reference for @dcms/form-rules 0.10.5. Read the Package Guide first for installation and integration. TypeScript declarations provide exact signatures and overloads.

## Modern Form definition

| Property | Contract |
|---|---|
| formId | Non-blank stable string ID |
| version | Finite number or non-blank string; payload versions compare by string form |
| fields | Ordered array of field definitions |
| field.id / label | Stable ID and display label |
| field.valueType | Intended control/value category; does not independently enforce a primitive type or required-field rule |
| field.mustBeCorrect | Whether an ordinary validation failure blocks Submit |
| field.validationRows | Ordered row definitions; preferred for new Forms |
| row.id | Stable, unique within its field |
| row.expression | Optional formula; absent/blank means use the entered value |
| row.criteria / keyword | Criterion name and its threshold, keyword expression or selection values |
| row.operator | AND, OR, AND NOT or OR NOT; ignored on the first row |
| row.caseSensitive | Text comparison setting where applicable |

IDs connect definitions, payloads, dependencies and results. Do not infer identity from labels. The compiler rejects unknown properties, duplicate IDs, incompatible rule representations and invalid authoring data. JSON Schemas are supplied in schemas/; schema checks are structural, while compilation also checks semantics and aggregate limits.

## Values

Values may be finite JavaScript numbers, strings, Booleans, null, or arrays of those values. Objects, undefined, sparse arrays, functions and non-finite numbers are rejected. Null is called BLANK in documentation; BLANK is not a formula literal. An omitted known field is read as null.

`valueType` is one of number, string or boolean. Checkbox arrays use the authored criteria rather than a separate array control type in the engine. The application validates mandatory input and its option catalogs. Normalize rich-text HTML to the same visible-text representation in the browser and server before evaluation.

## Legacy representations

Older field-wide expression plus validations and formulaValidations remain accepted for migration. A field cannot mix populated representations. Modern rows read entered/source values independently. Legacy field-wide calculated expressions can form a recursive calculated-field chain; those chains are cycle-checked. New definitions should use validationRows.

<!-- page -->
# Evaluation results and errors

## A Form result

`evaluateRecord` returns a Map of field results. `evaluateRecordPayload` returns the corresponding JSON shape with a fields dictionary. Both expose canSave, canSubmit and arrays of blocking, warning, error, invalid, valid and unvalidated field IDs.

| Field property | Meaning |
|---|---|
| enteredValue | Original source value |
| validationRowResults | Each row's source/calculated value, criterion outcome and available error information |
| validationPassed | Combined criterion result when evaluation succeeds |
| evaluationState | ok or error |
| validationState | not_validated, valid, warning, blocking; null on evaluation error |
| inputGuidance | Description of acceptable direct input or calculated-value criteria |
| evaluationErrorDetails | Structured errors: code, category, message and available row/source metadata |
| evaluationErrors / error | Existing text diagnostics for display compatibility |

Ordinary failures warn or block according to mustBeCorrect. Runtime errors always block Submit, even under OR/NOT. No rows means not_validated.

`canSave` permits correction drafts for evaluated values; apply host permissions and Save policy before persistence. Malformed payloads throw. A worker deadline yields no usable result.

## Error handling

| Example code | Typical cause |
|---|---|
| DEFINITION_INVALID | Invalid Form rules or shape |
| FORMULA_COMPATIBILITY | Wrong Form/version or old engine plan |
| PAYLOAD_INVALID | Unknown field or invalid value shape |
| FORMULA_DIV_ZERO | Division by zero |
| FORMULA_UNRESOLVED_REFERENCE | Missing FIELD reference |
| FORMULA_EXPECTED_NUMBER | Invalid native numeric conversion |
| FORMULA_LIMIT_EXCEEDED | Input, formula or result exceeds a ceiling |

Catch DcmsRuleError by code. Offsets are zero-based; parser line/column values are one-based. Form evaluation collects row errors; low-level formula APIs throw.

Treat returned plans, Maps, guidance and field results as read-only. Serializers create safe dictionaries, including for keys such as __proto__, but share field objects rather than making a full defensive clone.

<!-- page -->
# Form APIs for application integration

Import public APIs from @dcms/form-rules. Both JavaScript formats include optional declarations with signatures and source JSDoc.

| API | Use and contract |
|---|---|
| validateFormDefinition | Return authoring issues with severity. Warnings are advisory; use compilation before execution. |
| compileForm | Validate, detach/freeze definition data, prepare rows, build dependencies and return a reusable plan. Throws for an invalid definition. |
| getCompiledPlanCacheKey | Identity includes the complete definition and engine compatibility dimensions. |
| evaluateRecord | Full evaluation; options may contain trusted externalReferences as a Map. |
| evaluateRecordPayload | Full JSON-boundary evaluation after Form identity/version and value checks. |
| evaluateChange | Incremental evaluation returning the new Record result. |
| evaluateChangeDetailed | Also returns changedFieldIds, affectedFieldIds and statusChangedFieldIds. |
| affectedFields | Return the field and transitive dependents; this graph helper alone does not validate the ID. |
| getFieldInputGuidance | Return guidance prepared for the field; rejects an unknown field. |
| getCompiledPlanStats | Count rules, formulas, dependencies and prepared nodes. formulaInstructionCells is a historical name for AST-node count. |

## JSON request

```json
{
  "formId": "temperature", "formVersion": 1,
  "values": {"f": 212}
}
```

`recordValuesToMap` validates/copies entries. `externalReferencesToMap` handles trusted references; undefined becomes an empty Map. `serializeRecordEvaluation` converts a result to JSON. These helpers do not deep-clone arrays/field results.

## Incremental details

changedId is a hint. Snapshots detect other edits and array mutation. Results from another plan, JSON or callers are not reusable. Changed external values trigger full evaluation; the dependency index covers Form fields.

Unaffected field objects can be reused, which helps field-level React subscriptions. statusChangedFieldIds describes evaluation/validation state changes, not every changed number, message or row detail. `isRecordEvaluationCurrent` is a reuse check used by the Revision layer; only recognized results without external references qualify. It is not an authorization or integrity check.

<!-- page -->
# Revisions, batches and compatibility

A **Revision** groups independent Form Elements. Each Form Element has a nodeId and its own Form definition. Field IDs are scoped to that Form; two nodes can contain the same field ID without creating a shared dependency.

| API | Purpose |
|---|---|
| validateRevisionDefinition | Collect Revision/node issues and each Form's authoring issues |
| compileRevision | Compile one independent plan per Form Element |
| evaluateRevision | Evaluate Maps of node values and aggregate outcomes |
| evaluateRevisionPayload | Evaluate a complete JSON Revision request with identity checks |
| evaluateRevisionChange | Update and return aggregate Revision results |
| evaluateRevisionChangeDetailed | Also return target-node field lists and changed node states |
| getCompiledRevisionCacheKey | Complete Revision identity plus child-plan identities |
| revisionDefinitionSourceHash | Deterministic definition hash for cache identity |

The Map API treats an omitted node as empty entered values. The JSON API requires every compiled node, rejects unknown nodes, and checks each Form's identity/version. Its payload contains revisionId, revisionVersion and a formElements dictionary keyed by nodeId. Each node value has formId, formVersion and values; trusted server callers can also supply externalReferences.

The Revision result has canSubmit and node-ID lists for valid, unvalidated, warning, blocking and error outcomes. Each node contains its Form evaluation. `serializeRevisionEvaluation` converts the Map-based result to JSON.

During an incremental change, other nodes are retained only if their input snapshots still match. Additional edits are detected. Field-ID lists refer to the target node; statusChangedNodeIds describes aggregate states. A full fallback conservatively reports all target fields and nodes as status-change candidates. Supplying external references to the Revision incremental API forces full reevaluation.

## Batch and cache helpers

`evaluateBatch(plan, records)` evaluates `{recordId, entered}` entries synchronously in input order and preserves record IDs. It reuses one plan; it is not a database transaction. A malformed entry throws and stops the call.

`new LruCache(maxEntries)` stores least-recently-used entries; get/set/clear and size form its API. Capacity must be a positive safe integer. Undefined is a miss and does not refresh recency. No TTL or synchronization is provided.

`assertCompiledPlanCompatible` and `assertCompiledRevisionCompatible` reject engine identity mismatches. They do not authenticate a caller-created plan. `compatibilityHash64`, `canonicalJson` and `formDefinitionSourceHash` support deterministic cache identity; these hashes are not cryptographic signatures. Keep plans private and recompile from definitions after upgrades.

<!-- page -->
# Formula syntax, values and preparation

Formulas accept finite number literals, double-quoted strings, TRUE/FALSE, parentheses, native operators, explicit references and generic function calls. An initial equals sign is optional. Double a quote inside a formula string to represent a quote. FIELD("field-id") names a field/reference explicitly; VALUE is the current row's entered source value.

| Operator family | Operators |
|---|---|
| Arithmetic | +, -, *, /, ^ and unary + or - |
| Text concatenation | & |
| Comparison | =, <>, !=, <, <=, >, >= |
| Boolean | NOT, AND, OR |

Precedence: power/unary, multiplication/division, addition/subtraction, concatenation, comparison, NOT, AND, OR. Use parentheses for explicit grouping. There are no Excel A1 cells/ranges, JavaScript property access or eval/Function execution.

## Native conversion and errors

Numbers use finite IEEE-754 JavaScript Number values. This is not decimal-money arithmetic. Native numeric operators accept finite numbers or nonblank finite numeric strings. Null and Booleans do not silently become zero. Native Boolean conversion accepts Booleans, finite numbers and TRUE/FALSE text; it rejects BLANK. Native concatenation treats null as empty text and joins arrays with commas.

Positive and negative zero compare equal. Native array equality compares their serialized value/order; selection criteria have separate set semantics. Non-finite results and division by zero become controlled errors. Formula.js functions can have their own pinned null/coercion behavior: for example, SUM(null,5) returns 5 through the enabled function wrapper while native VALUE+5 with null throws.

## Formula APIs

| API | Contract |
|---|---|
| parseFormula | Return an AST with original-source spans; checks grammar/limits, not function availability |
| prepareFormula | Parse, resolve registry policy and prepare reusable nodes |
| evaluatePreparedFormula | Check compatibility, validate VALUE and the result; validate references when read |
| evaluateFormula | Convenience parse/prepare/evaluate call; prefer reuse for repeated entry |
| collectFormulaDependencies | Add static reference IDs to the supplied/new Set; not AST validation |
| prepareFormulaAst | Trusted-parser AST entry point; supplied source text is not reparsed against that AST |
| evaluatePreparedNode | Low-level recursive dispatcher; no whole-plan compatibility check |

The context has value and references (Map). Convenience/facade calls also accept the older fields alias; references takes precedence. `compileFormulaProgram` and `evaluateFormulaProgram` preserve the historical program API using a prepared AST. There is no custom bytecode VM in this release.

<!-- page -->
# Keyword syntax and validation criteria

Required Keywords is a separate literal-substring language. It has uppercase NOT, AND and OR; precedence is NOT before AND before OR. Parentheses group expressions. Whitespace between adjacent expressions inserts OR. Quoted phrases are one literal; quotes/backslashes can be escaped inside a quoted phrase.

| Expression | Meaning |
|---|---|
| PASS ACCEPTABLE | PASS OR ACCEPTABLE; produces an implicit-OR warning |
| PASS AND LOT | Both substrings must occur |
| GROUND AND (STUD OR STRAP) | GROUND plus either attachment term |
| "Pass Fail" | One phrase, including its space |
| OR-HOLD | One literal token, not a logical operator |

Case-sensitive matching follows the authored setting; otherwise terms/text are lowercased. Unicode normalization and word boundaries are not added automatically. Punctuation such as . * + ? [ ] has no regex meaning.

| Criterion name | Behavior |
|---|---|
| required_keywords | Match the parsed keyword expression against the supplied row value as text |
| number_greater_than / number_less_than / number_equal_to | Strict finite numeric comparison with the threshold |
| character_limit_more_than / less_than / equal_to | Compare JavaScript string length, measured in UTF-16 code units |
| selection_values_include / selection_values_exclude | Legacy/single-selection membership criteria |
| selection_values_include_any / include_all | At least one / every configured selection is present |
| selection_values_exclude_any / exclude_all | None / not the entire configured combination is present |

Selections use sets without changing input order or duplicates. The host rejects unknown options. Character counts are not grapheme counts. Numeric criteria reject null, arrays and Booleans.

## Parsing and rule helpers

`parseKeywordExpressionDetailed` returns AST plus warnings; `parseKeywordExpression` returns AST alone. `evaluateKeyword(ast, text, caseSensitive)` searches literals. `diagnoseKeywordExpression` and `diagnoseFormula` give valid/incomplete/invalid typing feedback; compilation remains authoritative. Formula incomplete-state detection uses message heuristics.

`compileValidationRule(s)` prepares validated rules; the plural form forces the first operator to AND. `runValidationRule(s)` checks the supplied value, without formulas. evaluateRecord handles modern row-specific formulas.

`combineValidationRowResults` applies NOT, then AND before OR; it ignores the first operator. Empty lists pass; missing Booleans are false. `isSelectionCriteria` recognizes selection names.

<!-- page -->
# Algorithms and design principles

## Compilation

1. Structural guards check the definition's shape, IDs, sizes and mutually exclusive representations. Semantic validation checks supported criteria, expressions and detectable conflicts.
2. Compilation makes a detached, frozen definition snapshot. Each formula is parsed once into a Chevrotain AST and prepared with resolved function IDs. Keyword expressions are parsed separately.
3. Each row records explicit field/reference dependencies. Local field references build a reverse dependency index. External references remain explicit values supplied by the host.
4. Legacy calculated-field chains are topologically ordered and checked for cycles. Modern validation rows read source values and do not form recursive calculations from other rows.
5. The plan stores compatibility identity and input guidance for reuse.

## Evaluation

A row starts with its field's source value. Its optional prepared formula visits only the required nodes and produces a candidate value. The criterion produces a Boolean. Row operators combine the Booleans. Runtime failures are collected separately and force an error state regardless of the Boolean combination. The Record layer aggregates field states into Submit eligibility.

Prepared calls use a fixed function registry. Lazy functions choose branches before evaluating arguments. Eager calls evaluate their arguments first, apply expansion guards, and clone arrays before invoking upstream functions that might mutate them. Outputs are normalized to allowed DCMS values and checked against result limits.

## Incremental updates

Private WeakMap entries connect returned results with their plan identity and detached input snapshots. The engine checks current inputs, detects extra changes, and walks the reverse graph to find affected fields. Unaffected field results are reused. A stale/unrecognized result or changed external values triggers full reevaluation. WeakMap state is intentionally lost on serialization.

For a graph with V fields and E dependency edges, walking the affected closure takes work proportional to visited fields/edges. Overall edit cost also includes input validation, snapshot comparison/copying and formula work. It is not necessarily proportional only to the announced field. Full evaluation cost depends on all evaluated rows and the functions they call. Third-party function cost cannot be inferred from the AST node count alone.

## Conservative explanations and conflict checks

`buildFieldInputGuidance` summarizes compiled rules. Direct compatible AND ranges/selections can become meaningful accepted-input guidance. Transformed formulas or OR/NOT combinations receive a criterion summary rather than an invented inverse input range. `describeValidationCriterion` formats one criterion; `getCompiledFieldInputGuidance` returns existing guidance.

`findRuleConflicts` detects selected numeric, length and selection contradictions. Its caller must supply comparable same-value AND rules. It does not interpret arbitrary OR/NOT groups or prove satisfiability. A lack of reported conflict does not guarantee that a Form can be completed.

<!-- page -->
# Function registry and dependency choices

Chevrotain handles tokenization and generic grammar. Formula.js supplies calculations. DCMS owns the supported language, reference semantics, strict native conversions, laziness, error handling and compatibility policy. This separation permits a broad function catalog without one grammar rule per function or exposing arbitrary JavaScript.

## Fixed Formula.js 4.6.1 catalog

| Status | Names | Treatment |
|---|---:|---|
| supported | 387 | Call the pinned upstream implementation through DCMS guards |
| dcms_implemented | 8 | DCMS supplies semantics such as lazy branches or corrected substitution |
| pending_date_semantics | 34 | No approved DCMS date representation yet |
| pending_error_value_semantics | 7 | Excel-style error-value behavior not adopted |
| excluded_nondeterministic | 4 | Hidden time/random state not allowed |
| pending_environment_semantics | 3 | HLOOKUP, VLOOKUP and LOOKUP await stable text comparison |
| excluded_spreadsheet_context | 2 | Worksheet/cell context not defined by DCMS |
| pending_unsafe_semantics | 1 | MATCH awaits acceptable matching semantics |

The 446 names exclude Formula.js utils; DCMS-specific entries are additional. reference/function-catalog.csv lists every registry entry and policy. Supported means callable; validate the numerical domains your application needs.

## Registry and conversion APIs

`getFunctionRegistryEntry(name)` resolves a case-insensitive name and enforces policy. `getFunctionRegistryEntryById(id)` is for IDs already produced by compatible preparation; it does not repeat the name-based policy gate. `formulaJsPolicyStatus(name)` classifies a catalog name but does not resolve an implementation. `formulaJsRegistrySummary()` counts all registry statuses, including unavailable names.

`callEagerFunction(entry, args)` requires a trusted permitted eager entry and evaluated, validated arguments. It must not be used to bypass policy. `isFieldFunction` recognizes the special FIELD reference call during preparation. `coerceNumber`, `coerceBoolean`, `coerceString` and `isDcmsBlank` expose native conversions/null recognition. Most applications should call Form evaluation instead of these low-level helpers.

## Why these packages

The Package Guide explains the pinned runtime/build dependencies. React, Express and esbuild belong to the example project; consumers need no TypeScript runtime.

DCMS application code has no public license grant. Upstream notices are preserved in bundled dependencies and the delivery's licenses directory. See LICENSE.txt and THIRD_PARTY_NOTICES.md. Package selection and wrapper policy do not establish full Excel compatibility or domain-specific numerical acceptance.

<!-- page -->
# Resource limits and isolation

These versioned ceilings restrict accepted work; they do not promise response times. Detectably excessive work fails with controlled errors.

| Area | Limit |
|---|---|
| Formula source | 8,192 characters |
| Formula parenthesis/function nesting | 64 |
| Formula AST nodes / depth | 4,096 / 128 |
| Arguments per function / unique references | 255 / 1,024 |
| Keyword expression / literal | 16,384 / 8,192 characters |
| Keyword parenthesis nesting / AST nodes | 32 / 512 |
| Input characters / value nodes | 8 Mi characters / 100,000 nodes |
| Output characters / value nodes | 1 Mi characters / 10,000 nodes |
| Array nesting | 32 |
| Known function iteration guard | 100,000 |
| Fields / rows per field / rows per Form | 5,000 / 256 / 50,000 |
| Form Elements in a Revision | 100 |
| Identifier / label length | 256 / 4,096 characters |
| Configured selection values | 10,000 |

Characters are UTF-16 units. Input budgets aggregate at the Form value boundary; low-level calls can have different scopes. Use Form/JSON entry points for application data.

Allocation magnifiers have preflight checks. Synchronous work cannot be interrupted on the same event loop. Isolate untrusted or expensive work in a worker.

## Browser worker example

`createBrowserRuleController(makeWorker, definition, options)` owns a cloned definition and payload snapshots. Options include debounceMs (default 120), deadlineMs (1,500) and onState. setPayload marks pending immediately. flush requests the latest result without duplicating an in-flight request or extending its deadline. dispose terminates work and rejects waiters.

Worker generation identifies an instance; revision identifies an edit. Replies must match both. A failure invalidates the instance before termination so a queued late reply cannot restore approval. A newer edit supersedes older waiters. Retry by editing or flushing. Initialization has a five-second deadline.

## Node worker example

`createIsolatedSession(definition, {timeoutMs, startupTimeoutMs, heapMb})` resolves after compilation. Defaults are 1,000 ms per evaluation, 5,000 ms startup and 128 MiB V8 old-generation memory. Only one request is allowed in flight; overlap rejects WORKER_BUSY. A deadline or worker failure requires a new session. Always await close in finally. The V8 limit is not a total operating-system memory limit; service concurrency and process policy remain host concerns.

<!-- page -->
# Maintain and integrate the source

The source project builds the TGZ runtime. Its six focused suites cover core behavior, input boundaries, independent/property checks, public APIs, limits and rule requirements.

| Module group | Responsibility |
|---|---|
| index.ts; types.ts; errors.ts | Public exports, contracts and stable error taxonomy |
| boundaries.ts; definition-validation.ts | Structural/aggregate guards and semantic authoring issues |
| formula-parser.ts; formula-evaluator.ts; bytecode.ts | Parse, prepare and evaluate; historical prepared-program facade |
| functions.ts; formulajs-policy.ts; function-guards.ts | Controlled registry, wrappers and expansion preflight checks |
| keyword-parser.ts; validation.ts | Literal keyword language, criteria and row combination |
| compile.ts; revision.ts | Field dependencies, full/incremental evaluation and Form aggregation |
| guidance.ts; rule-conflicts.ts | Honest guidance and selected contradiction checks |
| json-contract.ts; compatibility.ts; limits.ts | API conversion, cache identities and ceilings |
| diagnostics.ts; batch.ts; cache.ts | Typing feedback, ordered batch evaluation and LRU storage |

From source/: npm ci, npm run verify, npm run pack:local. Before redistribution, tools/set-version.mjs synchronizes package/compiler identities. Edit src/; rebuild ESM/CJS, declarations and maps.

Grammar, keyword, registry or limit changes can invalidate definitions. Keep original definitions and recompile; serialized plans are not an interchange format. Node 22.14.0 is the minimum. This delivery is checked on Linux x64 with Node 22.14.0, 24.19.0 and Chromium. Validate your deployment/browser combinations.

## Express transition contract

The supplied router accepts only action, formId, formVersion and values from a browser. It rejects client-supplied definitions, approval results and external references. The host resolves authoritative data inside withRecordTransaction and must enforce permissions and concurrency until commit completes.

| HTTP result from example | Meaning |
|---|---|
| 200 | Application commit callback completed |
| 400 / 413 | Invalid payload/JSON/resource input, or body too large |
| 409 | Form/engine compatibility mismatch |
| 422 | Current Record validation blocks Submit; no commit |
| 503 | Worker unavailable, failed or exceeded deadline; no usable result |
| 500 | Configuration/internal evaluation unavailable |

The host supplies authorization, database/audit writes, multi-Form transactions and Save policy. Only the server accepts persistence. Test the definitions and numerical domains your application uses.
