/** Formula.js catalog control tool. It detects upstream surface changes so dependency upgrades cannot silently expand DCMS. */
import * as FormulaJS from "@formulajs/formulajs";
import fs from "node:fs";
import path from "node:path";

/**
 * Enumerate the public Formula.js function surface recursively.
 * `utils` is intentionally excluded because it is implementation machinery, not user formula API.
 */
function flattenPublicFunctions(ns) {
  const out = new Map();

  function visit(value, formulaName, ancestors = new Set()) {
    if (typeof value !== "function" && !(value && typeof value === "object"))
      return;
    if (ancestors.has(value)) return;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);

    if (typeof value === "function" && formulaName) out.set(formulaName, value);
    for (const [childName, childValue] of Object.entries(value)) {
      visit(
        childValue,
        formulaName
          ? `${formulaName}.${childName.toUpperCase()}`
          : childName.toUpperCase(),
        nextAncestors
      );
    }
  }

  for (const [name, value] of Object.entries(ns)) {
    if (name === "utils") continue;
    visit(value, name.toUpperCase());
  }
  return out;
}

function readControlledCatalog() {
  const source = fs.readFileSync(
    path.resolve("src/formulajs-policy.ts"),
    "utf8"
  );
  const match = source.match(
    /export const FORMULAJS_4_6_1_FUNCTIONS = (\[[\s\S]*?\]) as const;/
  );
  if (!match)
    throw new Error(
      "Could not locate FORMULAJS_4_6_1_FUNCTIONS in src/formulajs-policy.ts"
    );
  return JSON.parse(match[1]);
}

const actual = [...flattenPublicFunctions(FormulaJS).keys()].sort();
const controlled = readControlledCatalog();
const actualSet = new Set(actual);
const controlledSet = new Set(controlled);
const duplicateControlled = controlled.filter(
  (x, i) => controlled.indexOf(x) !== i
);
const missing = actual.filter((x) => !controlledSet.has(x));
const extra = controlled.filter((x) => !actualSet.has(x));

const result = {
  formulaJsVersion: "4.6.1",
  actualPublicFunctionCount: actual.length,
  controlledFunctionCount: controlled.length,
  missing,
  extra,
  duplicateControlled: [...new Set(duplicateControlled)]
};

const outPath = path.resolve("docs/FORMULAJS_PUBLIC_CATALOG_4.6.1.json");
fs.writeFileSync(
  outPath,
  JSON.stringify({ ...result, functions: actual }, null, 2) + "\n"
);
console.log(JSON.stringify(result, null, 2));

if (
  process.argv.includes("--check") &&
  (missing.length || extra.length || duplicateControlled.length)
) {
  process.exitCode = 1;
}
