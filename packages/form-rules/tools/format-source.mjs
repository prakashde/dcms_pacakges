/** Keep maintained source readable; generated bundles and literal template payloads are excluded. */
import fs from "node:fs/promises";
import path from "node:path";
import { format, resolveConfig } from "prettier";

const check = process.argv.includes("--check");
const excluded = new Set([
  "examples/react-javascript/app.js",
  "examples/browser-worker.js"
]);
let checked = 0;
let changed = 0;

/** Visit authored code only, including new files added under the listed source roots. */
async function visit(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        await visit(file);
      }
    } else if (
      /\.(?:ts|tsx|js|jsx|mjs|css)$/.test(file) &&
      !excluded.has(file)
    ) {
      const before = await fs.readFile(file, "utf8");
      const after = await format(before, {
        ...(await resolveConfig(file)),
        filepath: file
      });
      checked += 1;
      if (before !== after) {
        changed += 1;
        if (check) console.error(file);
        else await fs.writeFile(file, after);
      }
    }
  }
}

for (const directory of [
  "src",
  "examples",
  "test",
  "tools",
  "bench",
  "prototype",
  "reference-ui/source"
]) {
  await visit(directory);
}
console.log(
  `${checked} source files checked; ${changed} ${check ? "need formatting" : "formatted"}.`
);
if (check && changed) process.exitCode = 1;
