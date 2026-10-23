# DCMS Form Rules resource limits

The shipped 0.10.5 source uses limits identity 3. These fixed ceilings reject input or known expansion risks. They are not execution-time guarantees for all third-party functions. For untrusted or expensive formulas, use worker/process isolation with an application deadline.

| Definition limit | Ceiling |
|---|---:|
| Formula source UTF-16 code units | 8,192 |
| Formula parenthesis depth | 64 |
| Formula AST nodes | 4,096 |
| Formula AST depth | 128 |
| Arguments per function | 255 |
| References per formula | 1,024 |
| Keyword expression code units | 16,384 |
| Keyword literal code units | 8,192 |
| Keyword parenthesis depth | 32 |
| Keyword AST nodes | 512 |
| Fields per Form | 5,000 |
| Rows per field | 256 |
| Total rows per Form | 50,000 |
| Form Elements per Revision | 100 |
| Identifier code units | 256 |
| Label code units | 4,096 |
| Configured selection values per rule | 10,000 |

| Runtime value limit | Ceiling |
|---|---:|
| Input character budget | 8,388,608 |
| Output character budget | 1,048,576 |
| Input value nodes | 100,000 |
| Output value nodes | 10,000 |
| Array nesting depth | 32 |
| Known function iteration estimate | 100,000 |

Runtime value guards apply at Record/formula boundaries. Direct keyword helper calls are lower-level string operations; the host still owns request limits. Node counts include arrays and their elements. The iteration estimate applies to specifically guarded functions, not an instrumented universal execution counter. Numeric factorial/combinatorial guards have stricter preflight caps. See src/function-guards.ts for the exact per-function rules.

The Express example and prototype enforce a 2 MiB HTTP body limit. The reference seed importer limits file size to 2 MiB and imported UI fields to 5,000 total; that UI cap is intentionally smaller than the theoretical sum of all engine Form Element caps. Limits can reject valid but operationally excessive rules. Change them only with a compatibility/version review and new evidence.
