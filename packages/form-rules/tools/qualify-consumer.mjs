/** Fresh offline consumer: inspect the shipped tree, exercise both module formats and type resolutions. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const root = process.cwd(),
  require = createRequire(import.meta.url),
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcms-consumer-"));
const archive = path.resolve(
  process.argv[2] ?? "release/dcms-form-rules-0.10.5.tgz"
);
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: 120000 });
try {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "dcms-clean-consumer",
      version: "1.0.0",
      private: true
    })
  );
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    archive
  ]);
  const tree = JSON.parse(run("npm", ["ls", "--all", "--json"]));
  const esm = `import assert from 'node:assert/strict';import * as e from '@dcms/form-rules';
 const d={formId:'consumer',version:1,fields:[{id:'x',label:'X',valueType:'number',mustBeCorrect:true,validationRows:[{id:'r',criteria:'number_greater_than',keyword:0}]}]};
 const p=e.compileForm(d);assert.equal(e.evaluateRecordPayload(p,{formId:'consumer',formVersion:1,values:{x:1}}).canSubmit,true);
 assert.equal(e.evaluateRecordPayload(p,{formId:'consumer',formVersion:1,values:{x:-1}}).canSubmit,false);
 assert.equal(e.evaluateFormula('SUBSTITUTE("abcabc","a","X",1)',{value:null}),'Xbcabc');
 assert.equal(e.evaluateFormula('-0=0',{value:null}),true);assert.throws(()=>e.evaluateFormula('MATCH(1,2)',{value:null}));
 assert.equal(e.FORMULA_COMPILER_VERSION,'0.10.5');console.log('ESM consumer passed');`;
  fs.writeFileSync(path.join(dir, "smoke.mjs"), esm);
  run(process.execPath, ["smoke.mjs"]);
  fs.writeFileSync(
    path.join(dir, "smoke.cjs"),
    `const assert=require('node:assert/strict');const e=require('@dcms/form-rules');assert.equal(e.evaluateFormula('ROUND(2.25,1)',{value:null}),2.3);assert.equal(e.FORMULA_COMPILER_VERSION,'0.10.5');console.log('CJS consumer passed');`
  );
  run(process.execPath, ["smoke.cjs"]);
  const parity = `import assert from 'node:assert/strict';import {createRequire} from 'node:module';import * as esm from '@dcms/form-rules';const cjs=createRequire(import.meta.url)('@dcms/form-rules');
 const d={formId:'parity',version:1,fields:[{id:'x',label:'X',valueType:'number',mustBeCorrect:true,validationRows:[{id:'r',expression:'FIELD("approved") / VALUE',criteria:'number_greater_than',keyword:0}]}]};
 for(const x of [null,0,-2,2,"2"]){const p={formId:'parity',formVersion:1,values:{x},externalReferences:{approved:1}};const a=esm.evaluateRecordPayload(esm.compileForm(d),p),b=cjs.evaluateRecordPayload(cjs.compileForm(d),p);assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));assert.equal(a.canSubmit,x===2||x==="2");if(x===0)assert.equal(a.fields.x.evaluationErrorDetails[0].code,'FORMULA_DIV_ZERO');}console.log('ESM/CJS result and diagnostic parity passed');`;
  fs.writeFileSync(path.join(dir, "parity.mjs"), parity);
  run(process.execPath, ["parity.mjs"]);
  const typed = `import {compileForm,evaluateRecord,type EvaluationErrorDetail,type FormDefinition} from '@dcms/form-rules';const d:FormDefinition={formId:'typed',version:1,fields:[]};const ok:boolean=evaluateRecord(compileForm(d),new Map()).canSubmit;const details:EvaluationErrorDetail[]=evaluateRecord(compileForm(d),new Map()).values.get('x')?.evaluationErrorDetails??[];`;
  for (const extension of ["mts", "cts"])
    fs.writeFileSync(path.join(dir, "typed." + extension), typed);
  run(process.execPath, [
    require.resolve("typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "typed.mts",
    "typed.cts"
  ]);
  const installed = path.join(dir, "node_modules/@dcms/form-rules");
  const lodash = JSON.parse(
    fs.readFileSync(path.join(installed, "node_modules/lodash/package.json"))
  ).version;
  if (lodash !== "4.18.1") throw new Error("Unqualified Lodash in consumer");
  const patchedMetadata = JSON.parse(
    fs.readFileSync(
      path.join(installed, "DCMS_DEPENDENCY_METADATA_PATCHES.json")
    )
  );
  const audit = JSON.parse(
    run("npm", [
      "audit",
      "--omit=dev",
      "--json",
      "--fetch-timeout=15000",
      "--fetch-retries=0"
    ])
  );
  const result = {
    archive,
    archiveSha256: createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex"),
    node: process.version,
    checks: [
      "offline install",
      "npm dependency tree",
      "ESM runtime",
      "CJS runtime",
      "ESM/CommonJS result and diagnostic parity",
      "strict TypeScript ESM",
      "strict TypeScript CJS",
      "bundled Lodash 4.18.1",
      "consumer npm audit"
    ],
    lodash,
    patchedMetadata,
    audit: audit.metadata,
    tree
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
