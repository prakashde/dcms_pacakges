/** Rebuild and run shipped JavaScript examples in a clean consumer, never through source self-resolution. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { collectExamples, executeExample } from "./document-examples.mjs";
const root = process.cwd(),
  version = JSON.parse(fs.readFileSync("package.json")).version;
const archive = path.resolve(
  process.argv[2] ?? `release/dcms-form-rules-${version}.tgz`
);
const out = path.resolve(
  process.env.DCMS_CONSUMER_EVIDENCE ?? "evidence/installed-examples"
);
fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcms-installed-")),
  checks = [],
  errors = [];
let browser, server, serverExit;
const check = (name, actual, expected = true) => {
  assert.deepEqual(actual, expected, name);
  checks.push({ name, passed: true });
};
try {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "plain-javascript-consumer",
      version: "1.0.0",
      private: true,
      type: "module"
    })
  );
  execFileSync(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive
    ],
    { cwd: dir, encoding: "utf8", timeout: 120000 }
  );
  const installed = path.join(dir, "node_modules/@dcms/form-rules");
  check(
    "Installed release version",
    JSON.parse(fs.readFileSync(path.join(installed, "package.json"))).version,
    version
  );
  // Supply the pinned host dependencies offline; the package itself supplies no React/Express dependency.
  const copied = new Set();
  function copyDependency(name) {
    if (copied.has(name)) return;
    const source = path.join(root, "node_modules", name);
    if (!fs.existsSync(source)) return;
    copied.add(name);
    fs.cpSync(source, path.join(dir, "node_modules", name), {
      recursive: true
    });
    const p = JSON.parse(fs.readFileSync(path.join(source, "package.json")));
    for (const child of Object.keys({
      ...p.dependencies,
      ...p.optionalDependencies
    }))
      copyDependency(child);
  }
  for (const name of ["react", "react-dom", "express", "esbuild"])
    copyDependency(name);
  check(
    "Consumer has no TypeScript compiler",
    fs.existsSync(path.join(dir, "node_modules/typescript")),
    false
  );
  fs.cpSync(path.join(installed, "examples"), path.join(dir, "examples"), {
    recursive: true
  });
  fs.rmSync(path.join(dir, "examples/react-javascript/app.js"));
  const build = `import {build} from 'esbuild';import fs from 'node:fs';
 const r=await build({entryPoints:['examples/react-javascript/main.jsx'],bundle:true,platform:'browser',format:'iife',target:'es2020',outfile:'examples/react-javascript/app.js',metafile:true,define:{'process.env.NODE_ENV':'"production"'}});fs.writeFileSync('bundle-inputs.json',JSON.stringify(Object.keys(r.metafile.inputs)));`;
  execFileSync(process.execPath, ["--input-type=module", "--eval", build], {
    cwd: dir,
    timeout: 30000
  });
  const inputs = JSON.parse(
    fs.readFileSync(path.join(dir, "bundle-inputs.json"))
  );
  check(
    "React bundle resolves installed ESM",
    inputs.includes("node_modules/@dcms/form-rules/dist/esm/index.js")
  );
  check(
    "React bundle contains no TypeScript or Node worker",
    inputs.some((x) => /\.tsx?$|worker_threads|isolated\/node/.test(x)),
    false
  );
  for (const example of collectExamples(installed)) {
    executeExample(example, dir);
    check(example.id + " from installed TGZ", true);
  }
  // The server runs under this selected Node executable, including its worker_threads evaluations.
  fs.writeFileSync(
    path.join(dir, "host.mjs"),
    `import {createDemoApp} from './examples/react-javascript/server.mjs';const d=createDemoApp();d.app.get('/test-commits',(q,s)=>s.json(d.saved));const server=d.app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,node:process.version})));`
  );
  server = spawn(process.execPath, ["host.mjs"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverExit = new Promise((resolve) => server.once("exit", resolve));
  let stderr = "";
  server.stderr.on("data", (x) => (stderr += x));
  const host = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(
      () => reject(new Error("Consumer server startup timeout: " + stderr)),
      15000
    );
    server.once("error", reject);
    server.stdout.on("data", (x) => {
      text += x;
      if (text.includes("\n")) {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(text.split("\n")[0]));
        } catch (e) {
          reject(e);
        }
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Consumer server exit " + code + ": " + stderr));
    });
  });
  check(
    "Express and worker host uses selected Node",
    host.node,
    process.version
  );
  const { chromium } = await import(
    pathToFileURL(process.env.DCMS_PLAYWRIGHT_MODULE)
  );
  browser = await chromium.launch({
    executablePath: process.env.DCMS_BROWSER_EXECUTABLE,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1000 }
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const url = `http://127.0.0.1:${host.port}`;
  await page.goto(url);
  await page.getByLabel("Pressure limit").waitFor();
  check(
    "Installed React mounts",
    await page.locator("h1").innerText(),
    "Pressure inspection"
  );
  check(
    "Installed React version",
    await page.locator(".eyebrow").innerText(),
    "DCMS FORM RULES " + version
  );
  check(
    "Initially ready",
    await page.getByRole("button", { name: "Submit record" }).isEnabled()
  );
  await page.getByLabel("Pressure limit").fill("90");
  check(
    "Dependent field blocks",
    await page.locator('[data-status="measured"]').innerText(),
    "blocking"
  );
  check(
    "Submit disabled",
    await page.getByRole("button", { name: "Submit record" }).isDisabled()
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-server-response]").textContent ===
      "Server committed draft."
  );
  check(
    "Draft recorded",
    (await (await fetch(url + "/test-commits")).json()).length,
    1
  );
  const post = async (values, extra = {}) =>
    fetch(url + "/records/DEMO/transition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        formId: "react-express-demo",
        formVersion: 1,
        action: "submit",
        values,
        ...extra
      })
    });
  const denied = await post({ limit: 90, measured: 95, note: "CHECKED" });
  check("Direct invalid Submit rejected", denied.status, 422);
  check(
    "Server identifies exact blocked field",
    (await denied.json()).evaluation.blockingFieldIds,
    ["measured"]
  );
  check(
    "Rejected Submit does not commit",
    (await (await fetch(url + "/test-commits")).json()).length,
    1
  );
  check(
    "Client external data rejected",
    (
      await post(
        { limit: 90, measured: 80, note: "CHECKED" },
        { externalReferences: { limit: 999 } }
      )
    ).status,
    400
  );
  await page.getByLabel("Measured pressure").fill("80");
  await page.getByLabel("Technician note").fill("Needs detail");
  check(
    "Advisory warning",
    await page.locator('[data-status="note"]').innerText(),
    "warning"
  );
  check(
    "Warning permits Submit",
    await page.getByRole("button", { name: "Submit record" }).isEnabled()
  );
  await page.getByRole("button", { name: "Submit record" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-server-response]").textContent ===
      "Server committed submit."
  );
  const commits = await (await fetch(url + "/test-commits")).json();
  check(
    "Exact committed actions",
    commits.map((x) => x.action),
    ["draft", "submit"]
  );
  check("Source values retained", commits[1].values.measured, "80");
  await page.screenshot({
    path: path.join(out, "installed-react-express.png"),
    fullPage: true
  });
  check("No browser errors", errors, []);
  const report = {
    version,
    node: process.version,
    platform: process.platform + "-" + process.arch,
    archiveSha256: createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex"),
    browser: await browser.version(),
    checks,
    passed: checks.length,
    errors,
    hostDependencies: Object.fromEntries(
      ["react", "react-dom", "express", "esbuild"].map((n) => [
        n,
        JSON.parse(
          fs.readFileSync(path.join(dir, "node_modules", n, "package.json"))
        ).version
      ])
    ),
    bundleInputs: inputs
  };
  fs.writeFileSync(
    path.join(out, "INSTALLED_EXAMPLES.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify({ node: process.version, passed: checks.length, errors })
  );
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill();
    await serverExit;
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
