# Formula.js Registry v3

Pinned implementation dependency: **@formulajs/formulajs 4.6.1**.

DCMS recursively enumerates the public Formula.js function namespace, including nested names such as `NORM.S.DIST`, `BINOM.DIST.RANGE`, and `T.DIST.RT`. The internal Formula.js `utils` namespace is not part of the DCMS formula language.

The registry is generated/reviewed at development time and committed as a DCMS compatibility artifact. Runtime code does not expose new Formula.js exports automatically.

## Classification

- **dcms_implemented**: 8
- **excluded_nondeterministic**: 4
- **excluded_spreadsheet_context**: 2
- **pending_date_semantics**: 34
- **pending_environment_semantics**: 3
- **pending_error_value_semantics**: 7
- **pending_unsafe_semantics**: 1
- **supported**: 387

Total Formula.js formula names: **446**.

DCMS-specific functions are tracked separately in the runtime registry and are not counted above.

## Policy

- `supported`: Formula.js implementation is exposed through the DCMS wrapper.
- `dcms_implemented`: DCMS owns evaluation semantics, usually because lazy/short-circuit behavior is required.
- `excluded_nondeterministic`: not exposed because the result can change with hidden clock/random state.
- `pending_date_semantics`: held until DCMS date representation is explicitly defined.
- `excluded_spreadsheet_context`: depends on worksheet/cell context DCMS does not define.
- `pending_error_value_semantics`: held until DCMS error-value semantics are finalized.

- `pending_environment_semantics`: HLOOKUP, VLOOKUP and LOOKUP need stable text comparison.
- `pending_unsafe_semantics`: MATCH needs bounded literal/wildcard semantics.

Registry coverage is not a proof of correctness for every argument combination. Consumers must qualify the function families used by their own Forms.

No Formula.js upgrade changes these statuses automatically.
