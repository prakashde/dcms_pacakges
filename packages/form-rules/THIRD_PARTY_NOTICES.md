# Third-party notices

DCMS Form Rules is a private application component; LICENSE.txt does not grant a public distribution license.

The runtime uses @formulajs/formulajs 4.6.1 (MIT), Chevrotain 10.5.0 (Apache-2.0) and their dependencies. Their original licenses remain inside the bundled packages. The standalone workbench bundles the same runtime; the developer delivery includes the corresponding notices in licenses/. TypeScript is a build dependency, not an installed-package runtime dependency. React, React DOM and Express belong to the runnable integration example.

Lodash is fixed at 4.18.1. During packaging, tools/pack.mjs updates the Lodash dependency declarations in chevrotain, @chevrotain/cst-dts-gen and @chevrotain/gast so their bundled manifests match the selected runtime. Upstream implementation source is unchanged. DCMS_DEPENDENCY_METADATA_PATCHES.json inside the TGZ lists the three manifest changes and their hashes.
