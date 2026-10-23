/**
 * Check module intent and attached callable documentation using the TypeScript syntax tree.
 * This enforces presence, not accuracy: the maintainer review in docs/SOURCE_COMMENT_REVIEW.md
 * explains the contract and algorithm review that accompanies this mechanical gate.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";

export function inspectModule(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const missing = [],
    declarations = [];
  if (!/^\s*\/\*\*?[\s\S]*?\S[\s\S]*?\*\//.test(text))
    missing.push("module intent");
  const exported = (node) =>
    node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const documented = (node) =>
    (node.jsDoc ?? []).some((doc) =>
      typeof doc.comment === "string"
        ? doc.comment.trim().length > 0
        : doc.comment?.some((part) => part.text?.trim())
    );
  const check = (node, name) => {
    const hasSummary = documented(node);
    declarations.push({ name, documented: hasSummary });
    if (!hasSummary) missing.push(name);
  };
  for (const node of source.statements) {
    if (!exported(node)) continue;
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      check(node, node.name?.text ?? "default");
    if (ts.isClassDeclaration(node))
      for (const member of node.members) {
        if (
          member.modifiers?.some(
            (m) =>
              m.kind === ts.SyntaxKind.PrivateKeyword ||
              m.kind === ts.SyntaxKind.ProtectedKeyword
          )
        )
          continue;
        if (
          ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member) ||
          ts.isConstructorDeclaration(member)
        ) {
          check(
            member,
            `${node.name.text}.${ts.isConstructorDeclaration(member) ? "constructor" : member.name.getText(source)}`
          );
        }
      }
  }
  return { file, declarations, missing };
}

// Negative controls ensure a module header cannot stand in for a later API contract,
// a detached comment cannot qualify, and an empty JSDoc block cannot satisfy the check.
const header = '/** Module purpose. */\nimport x from "x";\n';
assert.deepEqual(
  inspectModule("fixture.ts", header + "export function f() {}").missing,
  ["f"]
);
assert.deepEqual(
  inspectModule("fixture.ts", header + "/** */\nexport function f() {}")
    .missing,
  ["f"]
);
assert.deepEqual(
  inspectModule(
    "fixture.ts",
    header + "/** Explain helper. */\nconst n=1;\nexport function f() {}"
  ).missing,
  ["f"]
);
assert.deepEqual(
  inspectModule(
    "fixture.ts",
    header + "/** Explain contract. */\nexport function f() {}"
  ).missing,
  []
);
assert.deepEqual(
  inspectModule(
    "fixture.ts",
    header + "/** Cache. */\nexport class C { get(){} }"
  ).missing,
  ["C.get"]
);

const files = fs
  .readdirSync("src")
  .filter((name) => name.endsWith(".ts"))
  .sort();
const modules = files.map((name) =>
  inspectModule(
    path.join("src", name),
    fs.readFileSync(path.join("src", name), "utf8")
  )
);
const missing = modules.flatMap((m) =>
  m.missing.map((name) => `${m.file}: ${name}`)
);
const publicModules = new Set(
  [
    ...fs
      .readFileSync("src/index.ts", "utf8")
      .matchAll(/export \* from "\.\/(.+)\.js"/g)
  ].map((m) => m[1] + ".ts")
);
const callables = modules.flatMap((m) =>
  m.declarations.map((d) => ({
    ...d,
    public: publicModules.has(path.basename(m.file))
  }))
);
const report = {
  passed: !missing.length,
  modules: modules.length,
  exportedCallableContracts: callables.length,
  publicCallableContracts: callables.filter((c) => c.public).length,
  documented: callables.filter((c) => c.documented).length,
  negativeControls: 4,
  positiveControls: 1,
  missing,
  inventory: modules,
  scope:
    "Attached summaries for exported functions/classes and public class methods/constructors/accessors; not all types, constants, private functions or example methods. Presence is not proof of correctness."
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(report, null, 2));
else
  console.log(
    `Comment audit ${report.passed ? "PASS" : "FAIL"}: ${report.modules} modules; ${report.documented}/${report.exportedCallableContracts} callable contracts (${report.publicCallableContracts} package-public); 5 controls.`
  );
if (missing.length) {
  console.error(missing.join("\n"));
  process.exitCode = 1;
}
