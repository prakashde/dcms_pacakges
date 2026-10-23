/** Reproducible dual-module build. ESM and CJS are emitted from the same TypeScript source to avoid semantic drift. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const compiler = require.resolve("typescript/bin/tsc");
rmSync("dist", { recursive: true, force: true });

function run(args) {
  execFileSync(process.execPath, [compiler, ...args], { stdio: "inherit" });
}
run(["-p", "tsconfig.esm.json"]);
run(["-p", "tsconfig.cjs.json"]);
mkdirSync("dist/cjs", { recursive: true });
writeFileSync("dist/cjs/package.json", '{"type":"commonjs"}\n');

execFileSync(process.execPath, ["tools/export-function-catalog.mjs"], {
  stdio: "inherit"
});
