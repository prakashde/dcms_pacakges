# Source formatting

Run `npm run format` before reviewing source changes; run `npm run format:check` in CI. `npm run verify` includes the check. Prettier 3.6.2 is pinned as a development dependency, with two-space indentation, double quotes and an 80-column target. Long literal strings are retained where wrapping would change data. The formatter does not process compiled bundles, HTML templates, JSON fixtures or document authoring files.

The TypeScript source compiles to ordinary JavaScript for Node.js, React and Express. Build-generated JavaScript adapters are formatted during `npm run build:examples` in the full maintenance project. Do not edit generated bundles. Literal template contents are preserved.

Release 0.10.5 expands compressed statements and objects, preserving the 0.10.4 algorithms, API and integration behavior. Package/compiler and demonstration release labels advance to 0.10.5. Prepared plans from 0.10.4 should be rebuilt for the new compiler identity.
