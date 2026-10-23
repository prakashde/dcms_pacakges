/** Published quick starts and independent worked examples are executable release contracts. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectExamples,
  executeExample
} from "../tools/document-examples.mjs";
const examples = collectExamples();
test("DOC inventory includes all twelve Atlas examples and both module forms", () => {
  assert.equal(examples.filter((x) => x.id.startsWith("ATLAS-")).length, 12);
  for (const id of [
    "README-QUICKSTART",
    "NODE-ESM",
    "NODE-CJS",
    "DOC-NUMBERS",
    "DOC-STATES",
    "DOC-DEPENDENCY",
    "DOC-KEYWORDS"
  ])
    assert.ok(
      examples.some((x) => x.id === id),
      id
    );
});
for (const example of examples.filter((x) => !x.id.startsWith("ATLAS-")))
  test(example.id + " published example", () => executeExample(example));
