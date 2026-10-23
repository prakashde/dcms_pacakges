/** Compile optional typed examples and ship their ordinary JavaScript equivalents. */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import { format, resolveConfig } from "prettier";
const require = createRequire(import.meta.url);
execFileSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.examples.json"],
  { stdio: "inherit" }
);
for (const name of ["form-store", "revision-adapter"])
  fs.writeFileSync(
    `examples/${name}.js`,
    await format(fs.readFileSync(`.example-build/${name}.js`, "utf8"), {
      ...(await resolveConfig(`examples/${name}.js`)),
      filepath: `examples/${name}.js`
    })
  );
