# JavaScript React Node and Express integration

The distributed npm package is JavaScript. The engineering source uses TypeScript, which is compiled during the package build. A consuming JavaScript application does not need TypeScript, ts-node, a TypeScript loader or a TypeScript build step for this package.

| Consumer | Entry selected by the package | Verification |
|---|---|---|
| Node ES modules | dist/esm/index.js | Fresh installed TGZ executed with import |
| Node CommonJS | dist/cjs/index.js | Fresh installed TGZ executed with require |
| React browser application | JavaScript ESM through a browser bundler | Mounted React app in a real browser |
| Express service | The same Node JavaScript exports | Actual HTTP draft and Submit requests |
| Optional TypeScript consumer | Matching declaration files | Strict NodeNext checks for ESM and CommonJS |

## Node ES modules

<!-- dcms-example {"id":"NODE-ESM"} -->
```js
import {compileForm, evaluateRecordPayload} from '@dcms/form-rules';
```

## Node CommonJS

<!-- dcms-example {"id":"NODE-CJS","mode":"commonjs"} -->
```js
const {compileForm, evaluateRecordPayload} = require('@dcms/form-rules');
```

Use a .mjs file or type module package for the first form. Use .cjs or a CommonJS package for the second. The package exports map selects the corresponding compiled JavaScript.

## React and Express demonstration

The plain JavaScript example is examples/react-javascript. App.jsx uses React hooks and the shipped examples/form-store.js. JSX is ordinary React authoring syntax, transformed by the application's normal browser bundler. The example does not contain TypeScript annotations. The package's rules run inside the browser bundle; no Node-only worker_threads module is imported into the React component.

From the source checkout after npm ci, run npm run verify and then npm run example:react. Open http://127.0.0.1:32191. Change Pressure limit from 100 to 90. Measured pressure 95 becomes blocking and Submit record is disabled. Save draft remains available. Change the measured value to 80 and Submit becomes available again. The Express server reevaluates the source values before committing to the local demonstration's in-memory log.

The test also bypasses the disabled browser button by posting invalid values directly. Express rejects that submission with HTTP 422 and makes no commit. This demonstrates why the server must not trust a browser's canSubmit state.

The local demonstration is deliberately confined to loopback with a synthetic principal. Its in-memory persistence and synthetic authorization illustrate the integration; use createRecordRouter with real authorization and transaction callbacks in DCMS. The production adapter itself requires those callbacks and has no permissive defaults.

The tested versions are Node 22.14.0 and 24.19.0, React/React DOM 19.3.0 and Express 5.2.1. The package declares Node 22.14.0 or newer. Versions outside the measured matrix require host verification. This qualification establishes package/example compatibility; it does not imply that an unseen DCMS application has already been integrated.

## Installed-package reproduction

The release qualification creates a fresh consumer, installs the release TGZ offline, copies its shipped JavaScript examples, and rebuilds the React bundle with the pinned host dependencies. It verifies that bundling resolves the installed ESM entry and that the consumer has no TypeScript compiler. The Express server and its evaluation workers run under the selected Node executable. Direct invalid submissions are rejected without a commit.

Run `npm run qualify:installed` from the source checkout with `DCMS_PLAYWRIGHT_MODULE`, `DCMS_BROWSER_EXECUTABLE` and `DCMS_CONSUMER_EVIDENCE` set. This developer qualification tool supplies React, Express and esbuild from the qualified development tree. Those host dependencies are separate from the runtime package. The nineteen published JavaScript blocks execute from the installed consumer too.

## What the declaration correction changed

The JavaScript CommonJS entry already executed. The build had not generated the CommonJS .d.ts files referenced by the package metadata. That affected TypeScript's compiler/editor view of a CommonJS consumer. The corrected build emits matching declarations beside each JavaScript format. A declaration file is optional type information, not executable code. It does not introduce a TypeScript runtime dependency.

## References

React external-store subscription: https://react.dev/reference/react/useSyncExternalStore

Node package entry points and module formats: https://nodejs.org/api/packages.html

Express 5 API: https://expressjs.com/en/5x/api/
