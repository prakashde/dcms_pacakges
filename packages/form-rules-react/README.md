# @dcms/form-rules-react 0.4.0-parity.6

Reusable React/application layer for `@dcms/form-rules` 0.10.5 and the parity-complete DCMS Workbench.

The package supplies:

- Form and validation authoring components;
- Record controls and engine-derived feedback;
- Revision overview components and pure Form/Revision authoring summaries that never read Record evaluation;
- per-instance Workbench state and React subscriptions;
- input normalization, model conversion, Draft identity and seed/reference helpers;
- strict version-2 Workbench package parsing, deterministic serialization, and off-screen rules-engine preparation;
- atomic complete-Revision session replacement, Form-node structure proposals, and detached Form-description working copies;
- separately named Original Workbench seed-v1 interchange with typed legacy metadata and three independent value layers;
- verified Original, Seeded, Valid, Blocking, and Warning Record presets with current-Form or all-Forms scope;
- read-only accepted compatibility identities plus deterministic JSON/external SHA-256 integrity policy;
- generation-safe asynchronous evaluation/host-action controllers;
- minimal host contracts for production integration.

It does **not** implement DCMS authentication, permissions, PostgreSQL, Dexie/offline synchronization, production Lexical serialization, audit or workflow transactions.

## Important boundaries

- `@dcms/form-rules` remains the only formula/Required Keywords/validation/dependency authority.
- `summarizeWorkbenchFormAuthoring()` and `summarizeWorkbenchRevisionAuthoring()` report authoring state only; Record evaluation errors, blockers, warnings, and eligibility remain a separate axis.
- `createWorkbenchStore()` holds accepted in-memory Form/Record state; it is not durable persistence.
- Published Workbench/Form-store snapshots are runtime read-only: caller-owned definitions/values are detached before acceptance, snapshot objects/arrays are frozen, and exposed Maps reject mutation.
- `replaceRecordValues()` reevaluates one complete replacement set before publishing a matching snapshot.
- `replaceFormState()` compiles/evaluates a Form definition and its Record values before one accepted snapshot is published.
- `replaceRecordValuesBatch()` evaluates every participating Form before a multi-Form Record replacement publishes once.
- Rich Text uses a reference-compatible contenteditable control in this package. Production Lexical serialization and canonical validation-text conversion must be supplied by DCMS.
- Browser evaluation is interactive feedback. Controlled server transitions must reevaluate source values against the authoritative Form/version.
- Portable package codecs validate and detach transport data. The separate preparation API compares compiled model/definition semantics and evaluates current/Original values without publishing. Neither boundary applies Record values or replaces an accepted Revision.
- Version-2 package scope is explicit: `record-values` and `complete-revision` are never inferred from incidental properties. Legacy version-1 seed input uses a separate named compatibility reader and is never emitted as the current format.
- Form-node add/delete, Form-description confirmation, complete-Revision replacement, and Original-v1 import prepare complete candidates before a single authority-checked session publication.
- Record presets change Current values and their matching evaluations only. Accepted Original values, reusable Seeded fixtures, Form definitions, descriptions, ordering, Revision metadata, selection, and authoring dirty state are preserved.
- Valid, Blocking, and Warning are outcome guarantees, not fixture labels. A proposal is unavailable unless every targeted Form evaluates to the exact named state; all-Forms scope never falls back to a subset.
- Strict package schema v2 has deterministic JSON bytes and an external SHA-256 sidecar/manifest. It has no embedded digest field; adding one requires a deliberately versioned schema.

## Consumer ownership and lifecycle

- `createWorkbenchStore()` and the async controllers are caller-owned objects with explicit `dispose()` methods. Callers that create them are responsible for disposal.
- `createFormStore()` and `createWorkbenchShell()` are synchronous listener-only helpers. Their subscriptions return idempotent teardown callbacks; they do not own timers, transports or other background resources and therefore do not invent a separate disposal lifecycle.
- Workbench snapshots are top-level `readonly` TypeScript contracts and are also runtime-protected. Treat returned snapshot state as observation only; perform changes through store methods.
- `WorkbenchStoreMode` (`editor` / `preview` / `revision`) and `WorkbenchShellMode` (`revision` / `form` / `record`) are intentionally different vocabularies. The deprecated root `WorkbenchMode` alias refers only to the store-mode vocabulary.
- Shell node IDs are identity keys and must be unique. Duplicate IDs are rejected at construction rather than allowing one action to address multiple nodes.
- Starting or invalidating an async evaluation clears any previous result. A result belongs only to the generation that produced it.

## Build and verify

```bash
npm run build:react
npm run typecheck
npm test
npm run pack:react
```

The package is ESM-only in this development handoff. React 19.3.0 and Node 22.14.0 are the reproduced qualification fixtures, not instructions to upgrade the production DCMS application. The exact React peer, Node engine floor and `private` package status remain deliberate development guards until the actual DCMS dependency graph and package-distribution path are supplied and qualified; this review does not broaden those claims.
