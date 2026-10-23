/** Validate the acceptance trace against actual executed test/browser evidence and the controlled source inventory. */
import fs from "node:fs";
import path from "node:path";
const root = process.cwd(),
  evidence = path.resolve(
    process.env.DCMS_AUDIT_EVIDENCE ?? "evidence/test-audit"
  );
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(evidence, name), "utf8"));
const tap = fs.readFileSync(
  path.join(evidence, "FINAL_TESTS_COVERAGE.tap"),
  "utf8"
);
if (!/^# fail 0$/m.test(tap) || !/^# skipped 0$/m.test(tap))
  throw new Error("Final tests must pass with zero skips");
const names = [...tap.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => m[1]);
if (new Set(names).size !== names.length)
  throw new Error("Ambiguous duplicate test name");
const browser = read("browser-final/BROWSER_RESULTS.json"),
  editor = read("browser-audit-final/BROWSER_AUDIT.json"),
  compile = read("compilation/COMPILATION_AUDIT.json"),
  faults = read("FAULT_DETECTION_FINAL.json");
for (const x of [browser, editor])
  if (x.failed || x.fatal || x.errors.length)
    throw new Error("Browser evidence is not passing");
if (!compile.passed || faults.strengthenedDetected !== faults.count)
  throw new Error("Audit evidence failed");
const testRows = names.map((name, i) => ({
  id: `T${String(i + 1).padStart(3, "0")}`,
  name,
  requirements: []
}));
const test = (prefix) => {
  const hits = testRows.filter((x) => x.name.startsWith(prefix));
  if (!hits.length) throw new Error("No executed test for " + prefix);
  return hits;
};
const b = (prefix) => {
  const hits = [...browser.checks, ...editor.checks].filter((x) =>
    x.name.startsWith(prefix)
  );
  if (!hits.length || hits.some((x) => !x.ok))
    throw new Error("Missing browser assertion " + prefix);
  return hits.map((x) => x.name);
};
// The selectors below resolve to executed test names, not tests inferred from implementation files.
const configs = [
  [
    "STATE-01",
    [
      "A03",
      "ATLAS-SAVE-001",
      "ordinary validation failures",
      "field validation has four"
    ],
    [
      "Atlas atlas_state_blue",
      "DOM warning",
      "DOM unvalidated",
      "strict DOM treatment"
    ]
  ],
  [
    "STATE-02",
    ["A04", "A05", "F06", "C04", "runtime row-formula errors"],
    ["runtime error separate"]
  ],
  ["SCOPE-01", ["validation rows are field-local", "A13"], []],
  [
    "SCOPE-02",
    [
      "validation rows are field-local",
      "Formula.js calls cannot mutate",
      "A16"
    ],
    []
  ],
  [
    "SCOPE-03",
    ["cross-field validation dependencies", "A14", "A13"],
    ["dependency affected count"]
  ],
  [
    "SCOPE-04",
    ["validation-row source dependencies", "recursive legacy calculated-field"],
    []
  ],
  ["OP-01", ["P01", "F05"], ["B10", "B11", "B12"]],
  [
    "OP-02",
    [
      "P01",
      "ATLAS-EDGE-001",
      "row operators combine",
      "AND-family rows bind",
      "validation-row precedence exhaustively",
      "AND NOT failure"
    ],
    []
  ],
  ["OP-03", ["A06"], ["B16", "B17", "B18", "B20", "B21", "B22"]],
  ["OP-04", ["A04"], []],
  ["FORM-01", ["each validation row", "ATLAS-FORM-001", "ATLAS-TEXT-001"], []],
  [
    "FORM-02",
    [
      "formula parser and Required",
      "generic Chevrotain",
      "Formula.js catalog",
      "F03"
    ],
    []
  ],
  ["FORM-03", ["A14", "stable FIELD"], []],
  ["FORM-04", ["nondeterministic", "R14"], []],
  [
    "FORM-05",
    [
      "A05",
      "A09",
      "A15",
      "L01",
      "L02",
      "L03",
      "L04",
      "L05",
      "L08",
      "R01",
      "formula authoring diagnostics",
      "compileForm rejects semantically",
      "runtime definition validation rejects"
    ],
    ["B13", "B14", "B15"]
  ],
  ["KW-01", ["Required Keywords is literal", "A08"], []],
  ["KW-02", ["Required Keywords logical", "A08"], []],
  ["KW-03", ["implicit OR is valid", "ATLAS-KW-001"], ["B23", "B24"]],
  ["KW-04", ["A08", "ATLAS-KW-002"], ["keyword precedence"]],
  [
    "KW-05",
    [
      "Required Keywords supports explicit",
      "Required Keywords supports long",
      "A08"
    ],
    []
  ],
  [
    "GUIDE-01",
    ["compiled input guidance", "Checkbox selection guidance"],
    [],
    "PASS",
    "Q01/Q02 measure no parser calls during repeated evaluation."
  ],
  [
    "GUIDE-02",
    ["compiled input guidance"],
    ["focused guidance"],
    "REFERENCE_PASS"
  ],
  ["GUIDE-03", ["compiled input guidance", "R16"], []],
  [
    "SEL-01",
    ["ATLAS-SEL-001", "legacy scalar selection"],
    ["B09 criteria for Radio"]
  ],
  [
    "SEL-02",
    ["ATLAS-SEL-002", "Checkbox Any/All"],
    ["B09 criteria for Checkbox", "keyboard checkbox"]
  ],
  ["SEL-03", ["Include All plus Exclude Any", "ATLAS-SEL-003"], []],
  ["SEL-04", ["Checkbox selection edge", "ATLAS-SEL-004", "R19"], []],
  ["SEL-05", ["definition validation rejects provably", "A07"], []],
  ["DEF-01", ["A09", "definition validation rejects blank", "L03", "L08"], []],
  ["DEF-02", ["case-insensitive duplicate"], []],
  ["DEF-03", ["definition validation catches equality", "R16", "A07"], []],
  ["EDIT-01", [], ["B01", "B29", "B30"], "REFERENCE_PASS"],
  ["EDIT-02", [], ["B02", "B03", "B04", "B05", "B06"], "REFERENCE_PASS"],
  [
    "EDIT-03",
    [],
    ["B05", "B07", "B08"],
    "PARTIAL",
    "Local saved snapshot is verified; real database, audit history, concurrency and failed-save recovery require the DCMS application."
  ],
  [
    "REV-01",
    ["Revision aggregation", "A11", "A12"],
    ["representative suite six nodes"]
  ],
  [
    "REV-02",
    [],
    ["inline Form rendered", "React JavaScript mounted"],
    "REFERENCE_PASS"
  ],
  ["REV-03", [], ["Edit mode", "table visible"], "REFERENCE_PASS"],
  [
    "REV-04",
    ["Revision aggregation", "H01", "H02", "H03"],
    ["Express refuses bypass", "Rejected Submit makes no commit"],
    "PARTIAL",
    "Form HTTP enforcement and Revision aggregation pass; the production multi-Form transition, transaction and authorization implementation are not supplied."
  ],
  [
    "REC-01",
    ["A03", "A04", "H01"],
    ["Express committed invalid correction draft"],
    "DECISION",
    "The package permits correction drafts. Source FR-REC-18 can prohibit Save; requirements-owner reconciliation and separate mandatory-field behavior remain open."
  ],
  [
    "PERF-01",
    ["I01", "I04", "batch records reuse", "compiled plan reports"],
    [],
    "PASS",
    "Q01/Q02 directly count compilation and parsing; Q03/Q04 verify that those measurements detect injected recompilation."
  ],
  [
    "PERF-02",
    ["I04", "A13"],
    ["React dependent field blocks", "React Submit disabled"],
    "REFERENCE_PASS",
    "Immediate store updates are verified. Optional worker mode deliberately uses debounce and pending state; it is a separate integration choice."
  ],
  [
    "PERF-03",
    ["evaluateChangeDetailed identifies", "incremental prototype evaluation"],
    ["independent edit affected count", "dependency affected count"]
  ],
  [
    "PERF-04",
    [
      "P02",
      "A11",
      "A13",
      "R06",
      "R07",
      "R19",
      "incremental evaluation is equivalent"
    ],
    []
  ],
  [
    "PERF-05",
    [],
    ["scale limited affected fields"],
    "HOST",
    "30 browser edits use a two-animation-frame proxy in the container. Target device input-to-paint acceptance is not established."
  ],
  [
    "PERF-06",
    ["H01", "I04"],
    ["Express browser parity", "React corrected dependent value"],
    "REFERENCE_PASS",
    "Mounted JavaScript React/Express examples and exact HTTP/package parity pass; production components still require integration acceptance."
  ]
];
const source = fs.readFileSync(
  "docs/history/v0.9.2/ADJUSTED_ACCEPTANCE_CRITERIA_v0.9.2.md",
  "utf8"
);
const expected = [...source.matchAll(/^### (AC-VAL-[A-Z]+-\d+) - (.+)$/gm)].map(
  (m) => ({ id: m[1], title: m[2] })
);
const requirements = configs.map(
  ([short, ts, bs, status = "PASS", note = ""]) => {
    const id = "AC-VAL-" + short,
      title = expected.find((x) => x.id === id)?.title;
    if (!title) throw new Error("Unknown requirement " + id);
    const rows = [...new Set(ts.flatMap(test))];
    for (const r of rows) r.requirements.push(id);
    return {
      id,
      title,
      status,
      tests: rows.map((x) => x.id),
      testNames: rows.map((x) => x.name),
      browserChecks: bs.flatMap(b),
      note
    };
  }
);
if (
  expected.length !== requirements.length ||
  expected.some((x) => !requirements.some((y) => y.id === x.id))
)
  throw new Error("Incomplete acceptance inventory");
const engineering = [
  [
    "ENG-CRITERIA",
    "Source FR-FN-24 strict numeric/character thresholds and formula conversion",
    ["A01", "A02", "ATLAS-NUM-001", "ATLAS-COMP-001"]
  ],
  [
    "ENG-BOUNDARY",
    "Definition/value/JSON trust boundaries",
    [
      "R01",
      "R02",
      "R03",
      "R04",
      "R08",
      "R09",
      "R18",
      "R20",
      "A10",
      "A12",
      "A15",
      "C01",
      "C02",
      "C03",
      "C04",
      "C05",
      "Revision definition validation rejects",
      "Revision JSON/API",
      "JSON/API boundary preserves"
    ]
  ],
  [
    "ENG-LIMITS",
    "Resource and parser limits",
    [
      "L0",
      "R11",
      "R13",
      "P03",
      "P04",
      "formula authoring limits",
      "Required Keywords supports long"
    ]
  ],
  [
    "ENG-WORKER",
    "Worker lifecycle, real debounce, stale replies, deadline and recovery",
    ["W", "I01", "I02", "I05", "H04"]
  ],
  [
    "ENG-HTTP",
    "Application callback interface, authorization order and authoritative transition",
    ["H", "I03"]
  ],
  [
    "ENG-API",
    "Public API compatibility and lazy branch behavior",
    [
      "F",
      "R10",
      "R12",
      "R15",
      "R17",
      "R05",
      "prepared formulas reject",
      "compiled plan cache",
      "prepared formulas and compiled plans",
      "legacy field-wide expression",
      "DCMS BLANK semantics",
      "numeric results are finite",
      "Formula.js public catalog",
      "native Boolean operators",
      "IF is lazy",
      "Formula.js text/math"
    ]
  ],
  [
    "ENG-SCENARIOS",
    "Four illustrative scenarios with exact expected status sets",
    ["S "]
  ],
  [
    "ENG-SCALE",
    "100-field/1000-rule integration workload",
    [
      "100-field prototype",
      "prototype draft",
      "prototype submits",
      "incremental prototype"
    ]
  ]
];
const technical = engineering.map(([id, title, selectors]) => {
  const rows = [...new Set(selectors.flatMap(test))];
  for (const row of rows) row.requirements.push(id);
  return {
    id,
    title,
    status: "PASS",
    tests: rows.map((x) => x.id),
    testNames: rows.map((x) => x.name)
  };
});
const residual = testRows.filter((x) => !x.requirements.length);
if (residual.length)
  technical.push({
    id: "ENG-REGRESSION",
    title:
      "Additional retained language, catalogue, metadata and integration regression assertions",
    status: "PASS",
    tests: residual.map((x) => x.id),
    testNames: residual.map((x) => x.name)
  });
for (const row of residual) row.requirements.push("ENG-REGRESSION");
for (const row of testRows) {
  row.file =
    fs
      .readdirSync("test")
      .filter((x) => x.endsWith(".test.mjs"))
      .find((f) =>
        fs.readFileSync(path.join("test", f), "utf8").includes(row.name)
      ) ??
    (row.name.startsWith("S ")
      ? "review-scenarios.test.mjs"
      : row.name.startsWith("ATLAS-")
        ? "atlas.test.mjs"
        : /^(DOC|README-QUICKSTART|NODE-ESM|NODE-CJS)/.test(row.name)
          ? "documentation.test.mjs"
          : "unknown");
  if (row.file === "unknown") throw new Error("Unlocated test " + row.name);
  row.file = "test/" + row.file;
}
const coverage = tap
  .split("\n")
  .filter((x) => /^#\s+[^|]+\|\s+\d/.test(x))
  .map((line) => {
    const [name, lines, branches, functions, uncovered] = line
      .replace(/^#\s*/, "")
      .split("|")
      .map((x) => x.trim());
    return {
      file: name,
      lines: Number(lines),
      branches: Number(branches),
      functions: Number(functions),
      uncovered
    };
  });
const report = {
  version: JSON.parse(fs.readFileSync("package.json")).version,
  date: "2026-09-23",
  reviewer: "DCMSREVIEWWORK-A",
  source:
    "Controlled 45-item validation supplement; authority labels and unresolved source conflicts are retained.",
  counts: {
    acceptanceRequirements: requirements.length,
    byStatus: Object.fromEntries(
      [...new Set(requirements.map((x) => x.status))].map((s) => [
        s,
        requirements.filter((x) => x.status === s).length
      ])
    ),
    tests: testRows.length,
    browserChecks: browser.passed + editor.passed,
    selectedFaults: faults.count,
    originalDetected: faults.originalDetected,
    strengthenedDetected: faults.strengthenedDetected
  },
  requirements,
  engineeringContracts: technical,
  testInventory: testRows,
  coverage,
  limitations: [
    "PASS is package/reference evidence, not approval of the complete DCMS application.",
    "V8 coverage measures executed emitted JavaScript and selected adapters; it excludes CJS duplication, browser UI, third-party function internals and real host code.",
    "Selected faults are intentionally chosen; 30/30 is not an exhaustive mutation score.",
    "Full/incremental agreement uses a shared engine, so independent Boolean and arithmetic oracles provide separate semantic controls."
  ]
};
fs.mkdirSync("docs/test-audit", { recursive: true });
fs.writeFileSync(
  "docs/test-audit/REQUIREMENT_TRACE.json",
  JSON.stringify(report, null, 2) + "\n"
);
let md =
  "# Requirement-to-test trace — " +
  report.version +
  "\n\nAll " +
  requirements.length +
  " controlled acceptance IDs are accounted for. PASS and REFERENCE_PASS have executed evidence within their stated scope. PARTIAL, HOST and DECISION are not complete production acceptance. Test IDs resolve to exact names and source files in REQUIREMENT_TRACE.json.\n\n| Requirement | Status | Executed unit tests | Browser checks / qualification note |\n|---|---|---|---|\n";
for (const r of requirements)
  md += `| ${r.id} — ${r.title} | ${r.status} | ${r.tests.join(", ")} | ${[...r.browserChecks, r.note].filter(Boolean).join("; ").replaceAll("|", "/")} |\n`;
md +=
  "\n## Additional engineering contracts\n\n" +
  technical
    .map((r) => `- ${r.id}: ${r.title}. ${r.tests.join(", ")}`)
    .join("\n") +
  "\n";
fs.writeFileSync("docs/test-audit/REQUIREMENT_TRACE.md", md);
console.log(JSON.stringify(report.counts));
