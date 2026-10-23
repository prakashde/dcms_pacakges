/** Execute marked JavaScript exactly as published, from either the checkout or a clean installed consumer. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
export function collectExamples(root = process.cwd()) {
  const files = [
    "README.md",
    "docs/JAVASCRIPT_INTEGRATION.md",
    "docs/WORKED_EXAMPLES.md",
    ...fs
      .readdirSync(path.join(root, "docs/atlas"))
      .filter((x) => /^ATLAS-.*\.md$/.test(x))
      .sort()
      .map((x) => "docs/atlas/" + x)
  ];
  const examples = [],
    ids = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const marked = [
      ...source.matchAll(
        /<!-- dcms-example (\{[^\n]+\}) -->\s*```js\n([\s\S]*?)\n```/g
      )
    ];
    assert.equal(
      marked.length,
      (source.match(/<!-- dcms-example /g) || []).length,
      `Malformed example marker: ${file}`
    );
    if (file.includes("/ATLAS-"))
      assert.equal(
        marked.length,
        1,
        `Atlas requires one executable example: ${file}`
      );
    for (const [, metadata, code] of marked) {
      const entry = JSON.parse(metadata);
      assert.ok(entry.id && !ids.has(entry.id), "Unique example ID");
      ids.add(entry.id);
      examples.push({ ...entry, code, file });
    }
  }
  return examples;
}
export function executeExample(
  example,
  cwd = process.cwd(),
  node = process.execPath
) {
  const stdout = execFileSync(
    node,
    ["--input-type=" + (example.mode ?? "module"), "--eval", example.code],
    { cwd, encoding: "utf8", timeout: 15000 }
  );
  assert.equal(
    stdout,
    example.stdout ?? "",
    `${example.id}: exact published output`
  );
}
