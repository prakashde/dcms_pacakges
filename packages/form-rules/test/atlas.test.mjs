/** Execute the exact JavaScript shown in the twelve published Atlas examples. */
import test from "node:test";
import {
  collectExamples,
  executeExample
} from "../tools/document-examples.mjs";
for (const example of collectExamples().filter((x) =>
  x.id.startsWith("ATLAS-")
))
  test(example.id + " published example", () => executeExample(example));
