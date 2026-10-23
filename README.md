# DCMS form packages

Source repository for the two custom DCMS packages:

| Package | Version | Build output | Role |
| --- | --- | --- | --- |
| `@dcms/form-rules` | `0.10.5` | `dist/esm` + `dist/cjs` + types | Chevrotain formula/keyword parsers, Formula.js registry, validation compiler, rule engine |
| `@dcms/form-rules-react` | `0.4.0-parity.6` | `dist` (ESM) + types | React form/record/revision surfaces, Workbench store and session contracts |

Consumers never build these packages. They install the packed `.tgz` files from GitHub
Release assets, which already contain `dist/` and the engine runtime dependencies.

## Layout

```text
packages/form-rules/          engine source, tests, schemas, docs
packages/form-rules-react/    React adapter source and types
tools/                        Windows-safe pack and checksum helpers
artifacts/                    generated .tgz + .sha256 (git-ignored)
GIT_PACKAGE_WORKFLOW.html     step-by-step upload, release and DCMS install guide
```

## Branch model

| Branch | Purpose |
| --- | --- |
| `main` | Release-ready combination of both packages |
| `custom/form-rules` | Long-lived customization branch for the engine |
| `custom/form-rules-react` | Long-lived customization branch for the React adapter |

Create short feature branches from the matching customization branch, then merge back.
Both packages can live on one branch because each change should stay inside its package.
When an engine change alters the public contract or version, update the React package's
`peerDependencies` before releasing.

## Build, test, pack

```sh
npm ci
npm run build
npm test
npm run pack
```

`npm run pack` writes to `artifacts/`:

```text
dcms-form-rules-<version>.tgz
dcms-form-rules-<version>.tgz.sha256
dcms-form-rules-react-<version>.tgz
dcms-form-rules-react-<version>.tgz.sha256
```

The engine tarball bundles Chevrotain, Formula.js and Lodash, so DCMS can install it
without resolving the engine's runtime tree from the registry.

## Release

1. Update the version in the changed package's `package.json`.
2. If `@dcms/form-rules` changed version, update `@dcms/form-rules-react`'s
   `peerDependencies["@dcms/form-rules"]`, bump the React package version, and
   release a matching React tarball in the same train (even if its code is unchanged).
3. Run `npm ci && npm run build && npm test && npm run pack`.
4. Commit, tag, push, and upload the matching `.tgz` + `.sha256` to a GitHub Release.
5. In the DCMS app, copy the assets into `vendor/`, update `package.json`, run
   `npm install`, then build.

Full commands, verification steps, troubleshooting and AI prompts are in
[`GIT_PACKAGE_WORKFLOW.html`](./GIT_PACKAGE_WORKFLOW.html).
