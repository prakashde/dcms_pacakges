/** Keep the npm identity and prepared-plan compiler identity together during a package release. */
import fs from "node:fs";
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next ?? ""))
  throw new Error("Usage: node tools/set-version.mjs 0.10.5");
const pkg = JSON.parse(fs.readFileSync("package.json")),
  previous = pkg.version;
const lock = JSON.parse(fs.readFileSync("package-lock.json"));
const file = "src/formulajs-policy.ts",
  source = fs.readFileSync(file, "utf8");
const expected = `export const DCMS_FORMULA_COMPILER_VERSION = "${previous}" as const;`;
if (!source.includes(expected))
  throw new Error(
    "Compiler and package versions already differ; resolve before releasing."
  );
pkg.version = next;
lock.version = next;
lock.packages[""].version = next;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(
  file,
  source.replace(
    expected,
    `export const DCMS_FORMULA_COMPILER_VERSION = "${next}" as const;`
  )
);
for (const name of [
  "README.md",
  "docs/PACKAGE_GUIDE.md",
  "docs/FULL_REFERENCE.md"
])
  if (fs.existsSync(name))
    fs.writeFileSync(
      name,
      fs.readFileSync(name, "utf8").replaceAll(previous, next)
    );
console.log(
  `Package and compiler: ${previous} -> ${next}. Rebuild before distributing.`
);
