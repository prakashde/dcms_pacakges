/** Publication helper: exports the actual compiled registry so documentation is generated from runtime authority. */
import fs from "node:fs";
import path from "node:path";
import {
  FUNCTION_REGISTRY,
  FORMULAJS_VERSION,
  DCMS_FORMULA_REGISTRY_VERSION
} from "../dist/esm/index.js";

const formulaEntries = FUNCTION_REGISTRY.filter(
  (x) => x.source === "formulajs" || x.status === "dcms_implemented"
);
const rows = formulaEntries
  .map((x) => ({
    name: x.name,
    status: x.status,
    evaluationMode: x.evaluationMode,
    source: x.source
  }))
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csv =
  [
    ["name", "status", "evaluationMode", "source"].join(","),
    ...rows.map((r) =>
      [r.name, r.status, r.evaluationMode, r.source].map(csvEscape).join(",")
    )
  ].join("\n") + "\n";

fs.writeFileSync(path.resolve("docs/FORMULAJS_REGISTRY_v3.csv"), csv);
fs.writeFileSync(
  path.resolve("docs/FORMULAJS_REGISTRY_v3.json"),
  JSON.stringify(
    {
      registryVersion: DCMS_FORMULA_REGISTRY_VERSION,
      formulaJsVersion: FORMULAJS_VERSION,
      formulaJsFunctionCount: rows.length,
      counts,
      functions: rows
    },
    null,
    2
  ) + "\n"
);

const summary =
  `# Formula.js Registry v3\n\n` +
  `Pinned implementation dependency: **@formulajs/formulajs ${FORMULAJS_VERSION}**.\n\n` +
  `DCMS recursively enumerates the public Formula.js function namespace, including nested names such as \`NORM.S.DIST\`, \`BINOM.DIST.RANGE\`, and \`T.DIST.RT\`. The internal Formula.js \`utils\` namespace is not part of the DCMS formula language.\n\n` +
  `The registry is generated/reviewed at development time and committed as a DCMS compatibility artifact. Runtime code does not expose new Formula.js exports automatically.\n\n` +
  `## Classification\n\n` +
  Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join("\n") +
  "\n\n" +
  `Total Formula.js formula names: **${rows.length}**.\n\n` +
  `DCMS-specific functions are tracked separately in the runtime registry and are not counted above.\n\n` +
  `## Policy\n\n` +
  `- \`supported\`: Formula.js implementation is exposed through the DCMS wrapper.\n` +
  `- \`dcms_implemented\`: DCMS owns evaluation semantics, usually because lazy/short-circuit behavior is required.\n` +
  `- \`excluded_nondeterministic\`: not exposed because the result can change with hidden clock/random state.\n` +
  `- \`pending_date_semantics\`: held until DCMS date representation is explicitly defined.\n` +
  `- \`excluded_spreadsheet_context\`: depends on worksheet/cell context DCMS does not define.\n` +
  `- \`pending_error_value_semantics\`: held until DCMS error-value semantics are finalized.\n\n` +
  `- \`pending_environment_semantics\`: HLOOKUP, VLOOKUP and LOOKUP need stable text comparison.\n` +
  `- \`pending_unsafe_semantics\`: MATCH needs bounded literal/wildcard semantics.\n\n` +
  `Registry coverage is not a proof of correctness for every argument combination. Consumers must qualify the function families used by their own Forms.\n\n` +
  `No Formula.js upgrade changes these statuses automatically.\n`;
fs.writeFileSync(path.resolve("docs/FORMULAJS_REGISTRY_SUMMARY.md"), summary);
console.log(
  `Wrote Formula.js registry v3 with ${rows.length} Formula.js formula names.`
);
