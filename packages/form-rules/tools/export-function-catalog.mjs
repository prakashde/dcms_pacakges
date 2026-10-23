/** Keep the developer's function catalog aligned with the built registry, including DCMS-specific entries. */
import fs from "node:fs";
import { FUNCTION_REGISTRY } from "../dist/esm/index.js";
const rows = [...FUNCTION_REGISTRY].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0
);
const cell = (value) =>
  /[",\n]/.test(String(value))
    ? '"' + String(value).replaceAll('"', '""') + '"'
    : String(value);
fs.mkdirSync("reference", { recursive: true });
fs.writeFileSync(
  "reference/function-catalog.csv",
  [
    "name,status,evaluationMode,source",
    ...rows.map((r) =>
      [r.name, r.status, r.evaluationMode, r.source].map(cell).join(",")
    )
  ].join("\n") + "\n"
);
console.log(`Updated function catalog: ${rows.length} registry entries.`);
