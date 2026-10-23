import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import Ajv from "ajv/dist/2020.js";
import {
  compileForm,
  compileRevision,
  evaluateRecordPayload,
  evaluateRevisionPayload
} from "../dist/esm/index.js";
const ajv = new Ajv({ strict: true, allowUnionTypes: true });
for (const name of fs.readdirSync("schemas"))
  ajv.addSchema(
    JSON.parse(fs.readFileSync(path.join("schemas", name), "utf8"))
  );
const schema = (name) =>
  ajv.getSchema(`https://dcms.local/schemas/${name}.schema.json`);
test("C01 current scenarios and serialized Form/Revision results meet published schemas", () => {
  const fixtures = fs
    .readdirSync("examples/scenarios")
    .filter((x) => x.endsWith(".json"))
    .map((x) => JSON.parse(fs.readFileSync("examples/scenarios/" + x, "utf8")));
  for (const f of fixtures) {
    assert.ok(
      schema("form-definition")(f.definition),
      JSON.stringify(schema("form-definition").errors)
    );
    assert.ok(schema("record-values")(f.payload));
    const r = evaluateRecordPayload(compileForm(f.definition), f.payload);
    assert.ok(
      schema("record-evaluation")(r),
      JSON.stringify(schema("record-evaluation").errors)
    );
  }
  const f = fixtures[0],
    definition = {
      revisionId: "schema-review",
      version: 1,
      formElements: [{ nodeId: "__proto__", form: f.definition }]
    };
  const payload = JSON.parse(
    JSON.stringify({
      revisionId: "schema-review",
      revisionVersion: 1,
      formElements: { ["__proto__"]: f.payload }
    })
  );
  assert.ok(schema("revision-definition")(definition));
  assert.ok(schema("revision-record-values")(payload));
  const result = evaluateRevisionPayload(compileRevision(definition), payload);
  assert.ok(schema("revision-evaluation")(result));
  assert.ok(Object.hasOwn(result.formElements, "__proto__"));
});
test("C02 schemas reject blank identities, oversized definitions and wrong primitive types", () => {
  const good = {
    formId: "schema-review",
    version: 1,
    fields: [{ id: "x", label: "Value", valueType: "number" }]
  };
  for (const change of [
    (d) => (d.formId = " "),
    (d) => (d.version = ""),
    (d) => (d.fields[0].mustBeCorrect = "true"),
    (d) => (d.fields[0].id = "x".repeat(257)),
    (d) => (d.fields = Array(5001).fill(d.fields[0])),
    (d) => (d.fields[0].extra = true)
  ]) {
    const d = structuredClone(good);
    change(d);
    assert.equal(schema("form-definition")(d), false);
    assert.throws(() => compileForm(d));
  }
});
test("C03 local prototype rejects cross-origin requests, hidden files, saved drafts and oversized bodies", async (t) => {
  const dir = fs.mkdtempSync(path.resolve(".prototype-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync("prototype", path.join(dir, "prototype"), {
    recursive: true,
    filter: (src) => !src.includes("runtime")
  });
  fs.cpSync("dist", path.join(dir, "dist"), { recursive: true });
  const child = spawn(process.execPath, ["prototype/server.mjs"], {
    cwd: dir,
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stderr.on("data", (x) => (log += x));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Prototype did not start: " + log)),
        10000
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Prototype exited ${code}: ${log}`));
      });
      child.stdout.on("data", (x) => {
        log += x;
        const m = log.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      });
    });
    assert.equal((await fetch(base + "/")).status, 200);
    for (const target of [
      "/package.json",
      "/prototype/runtime/saved-draft.json",
      "/prototype/server.mjs",
      "/prototype/%2e%2e%2fpackage.json"
    ])
      assert.equal((await fetch(base + target)).status, 403, target);
    assert.equal(
      (
        await fetch(base + "/", {
          headers: { origin: "https://untrusted.example" }
        })
      ).status,
      403
    );
    assert.equal(
      await new Promise((resolve, reject) => {
        const req = http.get(
          base + "/",
          { headers: { host: "untrusted.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          }
        );
        req.on("error", reject);
      }),
      403
    );
    const post = (body) =>
      fetch(base + "/api/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body
      });
    assert.equal((await post("{bad")).status, 400);
    assert.equal(
      (await post(JSON.stringify({ values: { unknown: 1 } }))).status,
      400
    );
    assert.equal((await post("x".repeat(2 * 1024 * 1024 + 1))).status, 413);
  } finally {
    child.kill();
    await exited;
  }
});

test("C04 serialized structured runtime diagnostics satisfy schema and missing codes are rejected", () => {
  const d = {
    formId: "error-schema",
    version: 1,
    fields: [
      {
        id: "x",
        label: "X",
        valueType: "number",
        validationRows: [
          {
            id: "r",
            expression: "1 / VALUE",
            criteria: "number_equal_to",
            keyword: 1
          }
        ]
      }
    ]
  };
  const r = JSON.parse(
    JSON.stringify(
      evaluateRecordPayload(compileForm(d), {
        formId: "error-schema",
        formVersion: 1,
        values: { x: 0 }
      })
    )
  );
  assert.equal(
    schema("record-evaluation")(r),
    true,
    JSON.stringify(schema("record-evaluation").errors)
  );
  const detail = r.fields.x.evaluationErrorDetails[0];
  assert.equal(detail.code, "FORMULA_DIV_ZERO");
  delete detail.code;
  assert.equal(schema("record-evaluation")(r), false);
});

test("C05 emitted compiler identity matches the package release version", async () => {
  const { FORMULA_COMPILER_VERSION } = await import("../dist/esm/index.js");
  assert.equal(
    FORMULA_COMPILER_VERSION,
    JSON.parse(fs.readFileSync("package.json")).version
  );
});
