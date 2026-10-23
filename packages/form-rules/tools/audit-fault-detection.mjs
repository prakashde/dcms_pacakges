/** Seeded semantic faults in a disposable copy. Never mutate the working package. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd(),
  out = path.resolve(process.env.DCMS_AUDIT_EVIDENCE ?? "evidence/test-audit");
fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcms-faults-"));
for (const name of [
  "dist",
  "examples",
  ".example-build",
  "schemas",
  "prototype",
  "package.json",
  "test"
])
  fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
fs.symlinkSync(
  path.join(root, "node_modules"),
  path.join(dir, "node_modules"),
  "dir"
);
fs.mkdirSync(path.join(dir, "test-original"));
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"))
).version;
const baseline = "v0.10.0";
const originals = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", baseline, "test"],
  { cwd: root, encoding: "utf8" }
)
  .trim()
  .split("\n")
  .filter((x) => x.endsWith(".test.mjs"));
for (const f of originals)
  fs.writeFileSync(
    path.join(dir, "test-original", path.basename(f)),
    execFileSync("git", ["show", `${baseline}:${f}`], {
      cwd: root,
      encoding: "utf8"
    }).replaceAll('\"0.10.0\"', JSON.stringify(packageVersion))
  );
const base = {
  core: ["engine", "review-boundaries", "review-properties"],
  worker: ["review-integrations"],
  http: ["review-integrations"],
  limits: ["engine", "review-boundaries", "review-contracts"]
};
const extra = {
  core: ["audit-requirements"],
  worker: ["audit-worker-controller"],
  http: ["audit-integrations"],
  limits: ["audit-limits"]
};
const run = (id, group, original = false) => {
  const folder = original ? "test-original" : "test",
    files = original
      ? originals.map((x) => `${folder}/${path.basename(x)}`)
      : [...base[group], ...extra[group]].map((x) => `${folder}/${x}.test.mjs`);
  const r = spawnSync(
    process.execPath,
    ["--test", "--test-reporter=tap", ...files],
    { cwd: dir, encoding: "utf8", timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  );
  const log = (r.stdout ?? "") + (r.stderr ?? "");
  fs.writeFileSync(
    path.join(out, `${id}-${original ? "original" : "strengthened"}.tap`),
    log
  );
  const failures = [...log.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  const status = r.error
    ? "infrastructure-error"
    : r.status === 0
      ? "survived"
      : log.includes("ERR_ASSERTION")
        ? "detected-by-assertion"
        : "non-assertion-failure";
  return {
    status,
    exitCode: r.status,
    failures,
    tests: Number(log.match(/^# tests (\d+)/m)?.[1] ?? 0),
    assertionFailure: log.includes("ERR_ASSERTION"),
    error: r.error?.message
  };
};
const faults = [];
const add = (id, label, file, from, to, group = "core", occurrence = 1) =>
  faults.push({ id, label, file, from, to, group, occurrence });
add(
  "M01",
  "Numeric less-than incorrectly accepts equality",
  "dist/esm/validation.js",
  "numberValue < threshold",
  "numberValue <= threshold"
);
add(
  "M02",
  "Numeric greater-than incorrectly accepts equality",
  "dist/esm/validation.js",
  "numberValue > threshold",
  "numberValue >= threshold"
);
add(
  "M03",
  "Character less-than incorrectly accepts equality",
  "dist/esm/validation.js",
  "text.length < threshold",
  "text.length <= threshold"
);
add(
  "M04",
  "Character greater-than incorrectly accepts equality",
  "dist/esm/validation.js",
  "text.length > threshold",
  "text.length >= threshold"
);
add(
  "M05",
  "NOT row operands are not negated",
  "dist/esm/validation.js",
  "isNegated(operator) ? !raw : raw",
  "raw"
);
add(
  "M06",
  "AND groups use OR",
  "dist/esm/validation.js",
  "currentAndGroup = currentAndGroup && operand",
  "currentAndGroup = currentAndGroup || operand"
);
add(
  "M07",
  "Keyword matching ignores requested case sensitivity",
  "dist/esm/keyword-parser.js",
  "export function evaluateKeyword(node, value, caseSensitive) {",
  "export function evaluateKeyword(node, value, caseSensitive) { caseSensitive=false;"
);
add(
  "M08",
  "Booleans and BLANK are coerced into numeric threshold inputs",
  "dist/esm/validation.js",
  ": NaN;",
  ": Number(value);"
);
add(
  "M09",
  "Structured runtime error code is lost",
  "dist/esm/compile.js",
  "code: controlled.code",
  'code: "UNKNOWN"'
);
add(
  "M10",
  "Row calculation consumes preceding calculated value",
  "dist/esm/compile.js",
  "{\n                    value: raw,\n                    references: sourceReferences\n                }",
  "{ value: rowResults.length ? rowResults.at(-1).calculatedValue : raw, references: sourceReferences }"
);
add(
  "M11",
  "Advisory runtime errors permit Submit",
  "dist/esm/compile.js",
  "blockingFieldIds.push(id);\n            continue;",
  'if (v.validationState === "blocking") blockingFieldIds.push(id);\n            continue;'
);
add(
  "M12",
  "External-data changes reuse old results",
  "dist/esm/compile.js",
  "&&\n        sameMap(prior.external, options.externalReferences)",
  ""
);
add(
  "M13",
  "Missed edits are ignored during incremental evaluation",
  "dist/esm/compile.js",
  "id === changedId ||\n            !sameValue(prior.entered.get(id), entered.get(id))",
  "id === changedId"
);
add(
  "M14",
  "Incremental Revision accepts unknown nodes",
  "dist/esm/revision.js",
  'for (const id of enteredByNode.keys())\n        if (!plan.formElements.has(id))\n            throw new DcmsRuleError("PAYLOAD_INVALID", `Unknown Form Element ${id}.`);',
  "",
  "core",
  2
);
add(
  "M15",
  "Definition is retained by reference instead of snapshotted",
  "dist/esm/compile.js",
  "def = frozenSnapshot(def);",
  "def = def;"
);
add(
  "M16",
  "Include All is weakened to Include Any",
  "dist/esm/validation.js",
  "return allConfiguredSelected",
  "return anyConfiguredSelected"
);
add(
  "M17",
  "Form field ceiling rejects the valid maximum",
  "dist/esm/boundaries.js",
  "value.fields.length > DEFINITION_LIMITS.maxFields",
  "value.fields.length >= DEFINITION_LIMITS.maxFields",
  "limits"
);
add(
  "M18",
  "Per-field row ceiling rejects the valid maximum",
  "dist/esm/boundaries.js",
  "rs.length > DEFINITION_LIMITS.maxRowsPerField",
  "rs.length >= DEFINITION_LIMITS.maxRowsPerField",
  "limits"
);
add(
  "M19",
  "Input/output character budget rejects the valid maximum",
  "dist/esm/boundaries.js",
  "budget.characters > maxChars",
  "budget.characters >= maxChars",
  "limits"
);
add(
  "M20",
  "Array-depth budget rejects the valid maximum",
  "dist/esm/boundaries.js",
  "depth > DATA_LIMITS.maxArrayDepth",
  "depth >= DATA_LIMITS.maxArrayDepth",
  "limits"
);
add(
  "M21",
  "Worker accepts a reply from a failed generation",
  "examples/browser-worker-client.mjs",
  "if (\n        disposed ||\n        current !== generation ||\n        instance !== worker ||\n        data.generation !== generation\n      )\n        return;",
  "if(disposed)return;",
  "worker"
);
add(
  "M22",
  "Worker startup bypasses debounce",
  "examples/browser-worker-client.mjs",
  "if (dispatchRequested) send();\n        return;",
  "if(payload)send();return;",
  "worker"
);
add(
  "M23",
  "Repeated flush duplicates work and extends its deadline",
  "examples/browser-worker-client.mjs",
  "if (inFlightRevision === revision) return;",
  "",
  "worker"
);
add(
  "M24",
  "Delayed payload keeps caller-owned references",
  "examples/browser-worker-client.mjs",
  "payload = structuredClone(next);",
  "payload=next;",
  "worker"
);
add(
  "M25",
  "Recovered worker uses caller-mutated definition",
  "examples/browser-worker-client.mjs",
  "const ownedDefinition = structuredClone(definition);",
  "const ownedDefinition=definition;",
  "worker"
);
add(
  "M26",
  "Express skips authorization",
  "examples/express-adapter.mjs",
  'transition",\n    authorize,\n    express.json',
  'transition",(req,res,next)=>next(),express.json',
  "http"
);
add(
  "M27",
  "Express commits a blocked Submit",
  "examples/express-adapter.mjs",
  'body.action === "submit" && !evaluation.canSubmit',
  "false",
  "http"
);
add(
  "M28",
  "Express loses original raw values when committing",
  "examples/express-adapter.mjs",
  "values: body.values,\n                formId: definition.formId",
  "values:{},formId:definition.formId",
  "http"
);
add(
  "M29",
  "Express fails to supply server-owned external data",
  "examples/express-adapter.mjs",
  "values: body.values,\n                externalReferences\n              });",
  "values:body.values,externalReferences:body.externalReferences});",
  "http"
);
add(
  "M30",
  "Express reports commit failure as HTTP success",
  "examples/express-adapter.mjs",
  'res.status(500).json({ code: "EVALUATION_UNAVAILABLE" });',
  "res.status(200).json({saved:true});",
  "http"
);
const report = {
  packageVersion,
  baselineVersionAssertionsNormalizedTo: packageVersion,
  baselineTag: baseline,
  baselineCommit: execFileSync("git", ["rev-parse", baseline + "^{}"], {
    cwd: root,
    encoding: "utf8"
  }).trim(),
  workingCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim(),
  node: process.version,
  method:
    "All 106 baseline tests for each selected semantic fault; strengthened relevant groups; one fault at a time; syntax validation and assertion failures required. Not an exhaustive mutation score.",
  controls: [],
  faults: []
};
try {
  for (const group of Object.keys(base))
    for (const original of [true, false]) {
      if (original && group !== "core") continue;
      const result = run("control-" + group, group, original);
      report.controls.push({ group, original, ...result });
      if (result.status !== "survived")
        throw new Error(`Control suite failed: ${group}/${original}`);
    }
  for (const f of faults.filter(
    (x) => !process.argv[2] || process.argv[2].split(",").includes(x.id)
  )) {
    const filename = path.join(dir, f.file),
      source = fs.readFileSync(filename, "utf8");
    let offset = -1;
    for (let i = 0; i < f.occurrence; i++)
      offset = source.indexOf(f.from, offset + 1);
    if (offset < 0) throw new Error("Fault anchor missing: " + f.id);
    const changed =
      source.substring(0, offset) +
      f.to +
      source.substring(offset + f.from.length);
    fs.writeFileSync(filename, changed);
    try {
      const syntax = spawnSync(process.execPath, ["--check", filename], {
        encoding: "utf8"
      });
      if (syntax.status !== 0)
        throw new Error(`Invalid fault syntax ${f.id}: ${syntax.stderr}`);
      const original = run(f.id, f.group, true),
        strengthened = run(f.id, f.group, false);
      const item = {
        id: f.id,
        label: f.label,
        file: f.file,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        original,
        strengthened
      };
      report.faults.push(item);
      console.log(
        JSON.stringify({
          id: f.id,
          original: original.status,
          strengthened: strengthened.status
        })
      );
    } finally {
      fs.writeFileSync(filename, source);
    }
  }
} finally {
  report.count = report.faults.length;
  report.originalDetected = report.faults.filter(
    (x) => x.original.status === "detected-by-assertion"
  ).length;
  report.strengthenedDetected = report.faults.filter(
    (x) => x.strengthened.status === "detected-by-assertion"
  ).length;
  fs.writeFileSync(
    path.join(out, "FAULT_DETECTION.json"),
    JSON.stringify(report, null, 2)
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
if (
  report.faults.some((x) => x.strengthened.status !== "detected-by-assertion")
)
  process.exitCode = 1;
