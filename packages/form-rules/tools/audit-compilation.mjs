/** Instrument a disposable emitted-code copy to measure actual compilation and parsing calls. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const root = process.cwd(),
  out = path.resolve(process.env.DCMS_AUDIT_EVIDENCE ?? "evidence/compilation");
fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcms-compile-audit-"));
for (const name of ["dist", "examples", ".example-build", "package.json"])
  fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
fs.symlinkSync(
  path.join(root, "node_modules"),
  path.join(dir, "node_modules"),
  "dir"
);
const insert = (file, anchor, body) => {
  const p = path.join(dir, file),
    s = fs.readFileSync(p, "utf8");
  if (!s.includes(anchor)) throw new Error("Missing instrumentation anchor");
  fs.writeFileSync(p, s.replace(anchor, anchor + body));
};
for (const [file, anchor, key] of [
  ["dist/esm/compile.js", "export function compileForm(def) {", "compile"],
  [
    "dist/esm/formula-parser.js",
    "export function parseFormula(source) {",
    "formulaParse"
  ],
  [
    "dist/esm/keyword-parser.js",
    "export function parseKeywordExpressionDetailed(input) {",
    "keywordParse"
  ]
])
  insert(
    file,
    anchor,
    `globalThis.__dcmsAudit??={};globalThis.__dcmsAudit.${key}=(globalThis.__dcmsAudit.${key}??0)+1;process.stderr.write('DCMS_AUDIT ${key}\\n');`
  );
const definition = `{formId:'instrumented',version:1,fields:[{id:'x',label:'Number',valueType:'number',mustBeCorrect:true,validationRows:[{id:'r',expression:'VALUE * 2',criteria:'number_less_than',keyword:10}]},{id:'note',label:'Note',valueType:'string',validationRows:[{id:'k',criteria:'required_keywords',keyword:'PASS'}]}]}`;
fs.writeFileSync(
  path.join(dir, "store-probe.mjs"),
  `import assert from 'node:assert/strict';import {createFormStore} from './.example-build/form-store.js';
const d=${definition},store=createFormStore(d,new Map([['x',1],['note','PASS']]));const start=structuredClone(globalThis.__dcmsAudit);assert.equal(start.compile,1);assert.ok(start.formulaParse>0);assert.ok(start.keywordParse>0);
for(let i=0;i<25;i++){store.change('x',i);assert.equal(store.getEvaluation().canSubmit,i<5);}assert.deepEqual(globalThis.__dcmsAudit,start);store.replaceDefinition(structuredClone(d));assert.deepEqual(globalThis.__dcmsAudit,start);
const changed=structuredClone(d);changed.fields[0].validationRows[0].keyword=100;store.replaceDefinition(changed);assert.equal(globalThis.__dcmsAudit.compile,2);assert.ok(globalThis.__dcmsAudit.formulaParse>start.formulaParse);assert.equal(store.getEvaluation().canSubmit,true);console.log(JSON.stringify({start,afterDefinitionChange:globalThis.__dcmsAudit,edits:25}));`
);
fs.writeFileSync(
  path.join(dir, "worker-probe.mjs"),
  `import assert from 'node:assert/strict';import {createIsolatedSession} from './examples/isolated/node-session.mjs';const s=await createIsolatedSession(${definition});try{for(let i=0;i<Number(process.argv[2]);i++){const r=await s.evaluate({formId:'instrumented',formVersion:1,values:{x:i,note:'PASS'}});assert.equal(r.canSubmit,i<5);}}finally{await s.close();}`
);
const run = (name, args = []) => {
  const r = spawnSync(process.execPath, [name + "-probe.mjs", ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 15000
  });
  if (r.error) throw r.error;
  const counts = {};
  for (const m of r.stderr.matchAll(/DCMS_AUDIT (\w+)/g))
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  return {
    status: r.status,
    counts,
    stdout: r.stdout,
    assertionFailure: r.stderr.includes("ERR_ASSERTION"),
    stderr: r.stderr
  };
};
const report = {
  method:
    "Counters injected only into disposable compiled-code copies; no instrumentation in release.",
  checks: []
};
try {
  const store = run("store");
  report.store = { ...store, stderr: undefined };
  if (store.status !== 0) throw new Error(store.stderr);
  report.checks.push(
    "Q01 React store compiles once; 25 edits and an identical definition cause zero parsing/compilation calls; a changed definition recompiles once"
  );
  const single = run("worker", ["1"]),
    many = run("worker", ["25"]);
  if (single.status || many.status)
    throw new Error(single.stderr + many.stderr);
  report.worker = {
    oneEvaluation: single.counts,
    twentyFiveEvaluations: many.counts
  };
  if (
    single.counts.compile !== 1 ||
    JSON.stringify(single.counts) !== JSON.stringify(many.counts)
  )
    throw new Error("Worker reparsed or recompiled");
  report.checks.push(
    "Q02 Persistent Node worker has identical parse/compile counts for one and 25 evaluations"
  );
  insert(
    ".example-build/form-store.js",
    "change(id, value) {",
    "compileForm(definition);"
  );
  const storeFault = run("store");
  report.storeFault = {
    detectedByAssertion: storeFault.assertionFailure,
    counts: storeFault.counts
  };
  if (!storeFault.assertionFailure)
    throw new Error("Store instrumentation missed recompilation fault");
  report.checks.push(
    "Q03 Instrumentation detects injected per-edit recompilation"
  );
  insert(
    "examples/isolated/node-worker.mjs",
    'parentPort.on("message", ({ id, payload }) => {',
    "plan=compileForm(workerData.definition);"
  );
  const workerFault = run("worker", ["25"]);
  report.workerFault = {
    detected: workerFault.counts.compile !== 1,
    counts: workerFault.counts
  };
  if (workerFault.status !== 0 || workerFault.counts.compile !== 26)
    throw new Error("Worker instrumentation did not distinguish 26 compiles");
  report.checks.push(
    "Q04 Instrumentation detects injected per-request worker recompilation"
  );
  report.passed = report.checks.length === 4;
} finally {
  fs.writeFileSync(
    path.join(out, "COMPILATION_AUDIT.json"),
    JSON.stringify(report, null, 2)
  );
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
