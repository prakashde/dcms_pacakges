/** Repeatable browser qualification. Pass the controlled Chrome executable and Playwright module explicitly. */
import { createDemoApp } from "../examples/react-javascript/server.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = process.cwd(),
  out = path.resolve(process.env.DCMS_BROWSER_EVIDENCE ?? "evidence/browser");
fs.mkdirSync(path.join(out, "screenshots"), { recursive: true });
const { chromium } = await import(
  pathToFileURL(process.env.DCMS_PLAYWRIGHT_MODULE)
);
const browser = await chromium.launch({
  executablePath: process.env.DCMS_BROWSER_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const checks = [],
  errors = [],
  metrics = {};
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const check = (name, actual, expected = true) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, ...(ok ? {} : { actual, expected }) });
  if (!ok) console.error("FAIL", name, actual, expected);
};
const load = async (profile) => {
  await page.evaluate(
    (p) =>
      DCMSPrototype.loadRevisionSeed(p, "DCMSREVIEWWORK-A", { force: true }),
    profile
  );
};
const state = async (id, node = 0) =>
  page.evaluate(
    ([id, node]) => {
      const r =
        DCMSPrototype.state.revision.nodes[node].evaluation.values.get(id);
      return {
        validation: r.validationState,
        evaluation: r.evaluationState,
        blocking: r.blocking
      };
    },
    [id, node]
  );
const review = async () => {
  if ((await page.evaluate(() => DCMSPrototype.state.mode)) !== "revision")
    await page.locator("#submitRevisionGlobal").click();
};
const snap = async (name) => {
  const close = page.locator(".toast.show .toast-close");
  if (await close.count()) await close.click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(220);
  return page.screenshot({
    path: path.join(out, "screenshots", name + ".png"),
    fullPage: true
  });
};
const htmlPath = path.join(
  root,
  "reference-ui/DCMS_Form_Rules_Review_Workbench_v0.10.5.html"
);
const html = fs.readFileSync(htmlPath);
let fatal;
try {
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => !!window.DCMSPrototype);
  check(
    "title",
    await page.title(),
    "DCMS Form / Validation Revision Workspace Prototype v0.10.5"
  );
  check(
    "embedded compiler",
    await page.evaluate(() => DCMSFormRules.FORMULA_COMPILER_VERSION),
    "0.10.5"
  );
  check("seed menu", await page.locator("#seedMenu").count(), 1);
  const profiles = await page
    .locator("#revisionSeedSelect")
    .evaluate((el) => [...el.options].map((o) => o.value));
  check("review-suite available", profiles.includes("review-suite"));
  await page.locator("#seedMenu summary").click();
  await page.locator("#revisionSeedSelect").selectOption("scenario-suite");
  await page.locator("#allowSeedReplace").check();
  await page.locator("#loadRevisionSeedBtn").click();
  check(
    "representative suite six nodes",
    await page.evaluate(() => DCMSPrototype.state.revision.nodes.length),
    6
  );
  check(
    "representative definitions compile",
    await page.evaluate(() =>
      DCMSPrototype.state.revision.nodes.every((n) => !n.definitionError)
    )
  );
  await snap("01_scenario_editor");
  await load("validation-atlas");
  for (const [id, expected] of [
    ["atlas_save_warning", "warning"],
    ["atlas_state_blue", "not_validated"],
    ["atlas_edge_001", "valid"],
    ["atlas_sel_003", "valid"],
    ["atlas_sel_004", "valid"]
  ])
    check(`Atlas ${id}`, (await state(id)).validation, expected);
  check(
    "Atlas no evaluation errors",
    await page.evaluate(() =>
      [
        ...DCMSPrototype.state.revision.nodes[0].evaluation.values.values()
      ].every((v) => v.evaluationState === "ok")
    )
  );
  await review();
  check(
    "inline Form rendered",
    await page.locator("[data-inline-node]").count(),
    1
  );
  for (const [id, klass] of [
    ["atlas_save_warning", "warning"],
    ["atlas_state_blue", "unvalidated"]
  ])
    check(
      `DOM ${klass}`,
      (
        await page
          .locator(`[data-inline-preview-field="${id}"]`)
          .getAttribute("class")
      ).includes(klass)
    );
  await page
    .locator('[data-inline-preview-id="atlas_num_001"]')
    .first()
    .focus();
  check(
    "focused guidance",
    await page
      .locator('[data-inline-preview-field="atlas_num_001"]')
      .evaluate((el) => el.classList.contains("guidance-selected"))
  );
  for (const [id, opt] of [
    ["atlas_sel_003", "C"],
    ["atlas_sel_002", "B"]
  ]) {
    const cb = page.locator(`[data-inline-preview-id="${id}"][value="${opt}"]`);
    await cb.click();
    check(`${id} changed blocks`, (await state(id)).validation, "blocking");
    await cb.click();
    check(`${id} restored valid`, (await state(id)).validation, "valid");
  }
  await page
    .locator('[data-inline-preview-id="atlas_save_blocking"]')
    .fill("110");
  check(
    "strict failure",
    (await state("atlas_save_blocking")).validation,
    "blocking"
  );
  check(
    "strict DOM treatment",
    await page
      .locator('[data-inline-preview-field="atlas_save_blocking"]')
      .evaluate((el) => el.classList.contains("blocking"))
  );
  await snap("02_atlas_states");
  const kw = await page.evaluate(() => {
    const e = DCMSFormRules;
    const a = e.parseKeywordExpression("A OR B AND NOT C"),
      b = e.parseKeywordExpression("A B AND C");
    return [
      e.evaluateKeyword(a, "A C", false),
      e.evaluateKeyword(a, "B C", false),
      e.evaluateKeyword(a, "B", false),
      e.evaluateKeyword(b, "A", false),
      e.evaluateKeyword(b, "B C", false),
      e.evaluateKeyword(b, "B", false)
    ];
  });
  [true, false, true, true, true, false].forEach((v, i) =>
    check(`keyword precedence ${i}`, kw[i], v)
  );
  const near = await page.evaluate(() => {
    const f = (n) => (n === 1 ? "1" : `(${f(n / 2)}+${f(n / 2)})`),
      source = "=" + f(2048);
    const start = performance.now();
    const p = DCMSFormRules.prepareFormula(source);
    return {
      length: source.length,
      nodes: p.nodeCount,
      value: DCMSFormRules.evaluatePreparedFormula(p, {
        value: null,
        references: new Map()
      }),
      ms: performance.now() - start
    };
  });
  check("near-limit formula length", near.length, 8190);
  check("near-limit formula nodes", near.nodes, 4095);
  check("near-limit formula value", near.value, 2048);
  metrics.nearLimitFormula = near;
  await load("equipment-testing");
  await page.locator('[data-value-id="ambient_temp_c"]').fill("50");
  check(
    "independent edit affected count",
    await page.evaluate(() => DCMSPrototype.state.lastAffected),
    1
  );
  check(
    "ambient blocks",
    (await state("ambient_temp_c")).validation,
    "blocking"
  );
  await page.locator('[data-value-id="pressure_limit"]').fill("100");
  check(
    "dependency affected count",
    await page.evaluate(() => DCMSPrototype.state.lastAffected),
    2
  );
  check(
    "pressure dependent blocks",
    (await state("pressure_measured")).validation,
    "blocking"
  );
  check(
    "pressure source valid",
    (await state("pressure_limit")).validation,
    "valid"
  );
  await review();
  check(
    "Edit available",
    (await page.getByRole("button", { name: "Edit", exact: true }).count()) > 0
  );
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  check(
    "Edit mode",
    await page.evaluate(() => DCMSPrototype.state.mode),
    "editor"
  );
  check("table visible", await page.locator("#formRows").count(), 1);
  await load("stress-edge");
  check(
    "runtime error separate",
    (await state("runtime_error_demo")).evaluation,
    "error"
  );
  await review();
  const rich = page.locator('[data-inline-preview-id="rich_stress_edge"]');
  check("rich bold markup", (await rich.innerHTML()).includes("<strong>"));
  check("rich emphasis markup", (await rich.innerHTML()).includes("<em>"));
  check("rich baseline", (await state("rich_stress_edge")).validation, "valid");
  for (const word of ["FAIL", "PASS"]) {
    await rich.evaluate((el, word) => {
      el.innerHTML = `<p><b>Calibration complete.</b> Result <i>${word}</i>.</p>`;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }, word);
    check(
      `rich ${word}`,
      (await state("rich_stress_edge")).validation,
      word === "PASS" ? "valid" : "blocking"
    );
    check(
      "rich receives no markup",
      await page.evaluate(
        () =>
          !DCMSPrototype.state.revision.nodes[0].entered
            .get("rich_stress_edge")
            .includes("<")
      )
    );
  }
  for (const len of [19000, 100000, 1000000])
    for (const token of [false, true]) {
      const r = await page.evaluate(
        ([len, token]) => {
          const text =
            "Calibration stable. ".repeat(Math.ceil(len / 20)).slice(0, len) +
            (token ? " FINAL-TOKEN-ZX9" : "");
          const start = performance.now();
          if (len === 19000) {
            const el = document.querySelector(
              '[data-inline-preview-id="long_narrative"]'
            );
            el.value = text;
            el.dispatchEvent(new InputEvent("input", { bubbles: true }));
            return {
              state:
                DCMSPrototype.state.evaluation.values.get("long_narrative")
                  .validationState,
              ms: performance.now() - start
            };
          }
          const p = DCMSFormRules.compileForm({
            formId: "long",
            version: 1,
            fields: [
              {
                id: "x",
                label: "Long text",
                valueType: "string",
                mustBeCorrect: true,
                validationRows: [
                  {
                    id: "r",
                    criteria: "required_keywords",
                    keyword: "FINAL-TOKEN-ZX9"
                  }
                ]
              }
            ]
          });
          return {
            state: DCMSFormRules.evaluateRecord(
              p,
              new Map([["x", text]])
            ).values.get("x").validationState,
            ms: performance.now() - start
          };
        },
        [len, token]
      );
      check(
        `long text ${len} token ${token}`,
        r.state,
        token ? "valid" : "blocking"
      );
      metrics[`long-${len}-${token}`] = r.ms;
    }
  await snap("03_rich_text_and_long_text");
  await load("scenario-suite");
  const roundtrip = await page.evaluate(() => {
    const p = DCMSPrototype.createSeedPackage();
    DCMSPrototype.importSeedObject(JSON.parse(JSON.stringify(p)), {
      force: true
    });
    return {
      schema: p.schema,
      version: p.schemaVersion,
      nodes: DCMSPrototype.state.revision.nodes.length,
      profile: DCMSPrototype.state.revision.profile
    };
  });
  check("seed schema", roundtrip.schema, "dcms-form-validation-seed");
  check("seed version", roundtrip.version, 1);
  check("round-trip nodes", roundtrip.nodes, 6);
  check("imported profile", roundtrip.profile, "imported");
  check(
    "toast shown",
    await page.locator("#toast").evaluate((el) => el.classList.contains("show"))
  );
  await page.locator(".toast-close").click();
  check(
    "toast dismissed",
    await page
      .locator("#toast")
      .evaluate((el) => !el.classList.contains("show"))
  );
  await load("review-suite");
  check(
    "new reviewed cases",
    await page.evaluate(() => DCMSPrototype.state.revision.nodes.length),
    3
  );
  check(
    "new cases compile",
    await page.evaluate(() =>
      DCMSPrototype.state.revision.nodes.every((n) => !n.definitionError)
    )
  );
  check(
    "new cases baseline Submit",
    await page.evaluate(() =>
      DCMSPrototype.state.revision.nodes.every((n) => n.evaluation.canSubmit)
    )
  );
  await review();
  await snap("04_reviewed_examples");
  const security = await page.evaluate(() => {
    const P = DCMSPrototype;
    const seed = P.createSeedPackage();
    seed.revision.nodes[0].title = '<img src=x onerror="window.injection=1">';
    P.importSeedObject(seed, { force: true });
    const duplicate = structuredClone(seed);
    duplicate.revision.nodes.push(structuredClone(duplicate.revision.nodes[0]));
    let rejected = false;
    try {
      P.importSeedObject(duplicate, { force: true });
    } catch {
      rejected = true;
    }
    return {
      injection: window.injection ?? null,
      duplicateRejected: rejected,
      unexpectedImages: document.querySelectorAll("img[src=x]").length
    };
  });
  check("import title escaped", security.injection, null);
  check("no injected images", security.unexpectedImages, 0);
  check("duplicate nodes rejected", security.duplicateRejected);
  await load("stress-edge");
  const safe = await page.evaluate(() => {
    const P = DCMSPrototype,
      p = P.createSeedPackage(),
      f = p.revision.nodes[0].uiFields.find((f) => f.id === "rich_stress_edge");
    f.richHtml =
      '<p>Calibration complete. PASS.</p><script>window.injection=2</script><img src=x onerror="window.injection=3"><svg onload="window.injection=4"></svg>';
    P.importSeedObject(p, { force: true });
    return true;
  });
  await review();
  check(
    "rich sanitizer scripts",
    await page
      .locator('[data-inline-preview-id="rich_stress_edge"] script')
      .count(),
    0
  );
  check(
    "rich sanitizer attributes",
    await page
      .locator('[data-inline-preview-id="rich_stress_edge"] [onerror]')
      .count(),
    0
  );
  check(
    "rich sanitizer execution",
    await page.evaluate(() => window.injection ?? null),
    null
  );
  const corrections = await page.evaluate(() => {
    const e = DCMSFormRules,
      ev = (s) => e.evaluateFormula(s, { value: null });
    let nonfinite = false,
      deep = false;
    try {
      ev("1e309");
    } catch {
      nonfinite = true;
    }
    try {
      e.parseKeywordExpression("NOT ".repeat(1200) + "OK");
    } catch (x) {
      deep = x.code === "KEYWORD_LIMIT_EXCEEDED";
    }
    return {
      zero: ev("-0=0"),
      sub: ev('SUBSTITUTE("abcabc","a","X",1)'),
      punctuation: e.evaluateKeyword(
        e.parseKeywordExpression("OR-HOLD"),
        "OR-HOLD",
        false
      ),
      nonfinite,
      deep
    };
  });
  for (const [key, value] of Object.entries({
    zero: true,
    sub: "Xbcabc",
    punctuation: true,
    nonfinite: true,
    deep: true
  }))
    check(`browser correction ${key}`, corrections[key], value);
  await load("scale");
  await page.evaluate(() => DCMSPrototype.switchNode("form-2"));
  check(
    "scale fields",
    await page.evaluate(() => DCMSPrototype.state.definition.fields.length),
    100
  );
  check(
    "scale rules",
    await page.evaluate(() =>
      DCMSPrototype.state.definition.fields.reduce(
        (n, f) => n + f.validationRows.length,
        0
      )
    ),
    1000
  );
  const times = await page.evaluate(async () => {
    const id = DCMSPrototype.state.definition.fields[0].id,
      el = document.querySelector(`[data-value-id="${id}"]`),
      samples = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      el.value = String(70 + i / 100);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      samples.push(performance.now() - t);
    }
    return samples.sort((a, b) => a - b);
  });
  metrics.inputToTwoFramesMs = {
    n: times.length,
    median: times[14],
    p95: times[28],
    max: times.at(-1)
  };
  check(
    "scale limited affected fields",
    await page.evaluate(() => DCMSPrototype.state.lastAffected <= 10)
  );
  await snap("05_scale_100x10");
  await page.setViewportSize({ width: 1024, height: 768 });
  await load("review-suite");
  await review();
  await snap("06_review_1024");
  check(
    "narrow review controls present",
    await page.locator("#submitRevisionGlobal").count(),
    1
  );
  // Keyboard activation exercises a real checkbox control rather than calling its handler.
  await load("validation-atlas");
  await review();
  const cb = page.locator(
    '[data-inline-preview-id="atlas_sel_003"][value="C"]'
  );
  await cb.focus();
  await page.keyboard.press("Space");
  check(
    "keyboard checkbox changes state",
    (await state("atlas_sel_003")).validation,
    "blocking"
  );
  // Real module worker evaluation, termination and recovery on the HTTP origin required by browsers.
  const host = http.createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      return res.end("<!doctype html><title>Worker qualification</title>");
    }
    const names = [
      "/examples/browser-worker-client.mjs",
      "/examples/browser-worker.js"
    ];
    if (!names.includes(req.url)) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader("content-type", "text/javascript");
    res.end(fs.readFileSync(path.join(root, req.url)));
  });
  await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
  const workerPage = await browser.newPage();
  workerPage.on("pageerror", (e) => errors.push(String(e)));
  try {
    await workerPage.goto(`http://127.0.0.1:${host.address().port}/`);
    const wr = await workerPage.evaluate(async () => {
      const { createBrowserRuleController } = await import(
        "/examples/browser-worker-client.mjs"
      );
      const definition = {
        formId: "worker-review",
        version: 1,
        fields: [
          {
            id: "x",
            label: "X",
            valueType: "number",
            mustBeCorrect: true,
            validationRows: [
              {
                id: "r",
                expression: "IF(VALUE=0,1,BESSELJ(1,1000000000))",
                criteria: "number_greater_than",
                keyword: 0
              }
            ]
          }
        ]
      };
      const c = createBrowserRuleController(
        () => new Worker("/examples/browser-worker.js"),
        definition,
        { deadlineMs: 80 }
      );
      const payload = (x) => ({
        formId: "worker-review",
        formVersion: 1,
        values: { x }
      });
      try {
        c.setPayload(payload(0));
        const pending = c.getState().canSubmit;
        const first = await c.flush();
        c.setPayload(payload(1));
        const pendingHeavy = c.getState().canSubmit;
        let code;
        try {
          await c.flush();
        } catch (e) {
          code = e.code;
        }
        const failed = c.getState().canSubmit;
        c.setPayload(payload(0));
        const recovered = await c.flush();
        return {
          pending,
          first: first.canSubmit,
          pendingHeavy,
          code,
          failed,
          recovered: recovered.canSubmit
        };
      } finally {
        c.dispose();
      }
    });
    for (const [key, value] of Object.entries({
      pending: false,
      first: true,
      pendingHeavy: false,
      code: "WORKER_DEADLINE",
      failed: false,
      recovered: true
    }))
      check(`real browser worker ${key}`, wr[key], value);
  } finally {
    await workerPage.close();
    await new Promise((resolve) => host.close(resolve));
  }
  // Mount an actual JavaScript React app and submit through the actual Express adapter.
  const demo = createDemoApp(),
    demoServer = demo.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => demoServer.once("listening", resolve));
  const reactPage = await browser.newPage({
    viewport: { width: 1200, height: 1000 }
  });
  reactPage.on("pageerror", (e) => errors.push(String(e)));
  try {
    const url = `http://127.0.0.1:${demoServer.address().port}`;
    await reactPage.goto(url);
    await reactPage.getByLabel("Pressure limit").waitFor();
    check(
      "React release label",
      await reactPage.locator(".eyebrow").innerText(),
      "DCMS FORM RULES 0.10.5"
    );
    check(
      "React JavaScript mounted",
      await reactPage.locator("h1").innerText(),
      "Pressure inspection"
    );
    check(
      "React initial Submit available",
      await reactPage.getByRole("button", { name: "Submit record" }).isEnabled()
    );
    await reactPage.getByLabel("Pressure limit").fill("90");
    check(
      "React dependent field blocks",
      await reactPage.locator('[data-status="measured"]').innerText(),
      "blocking"
    );
    check(
      "React Submit disabled",
      await reactPage
        .getByRole("button", { name: "Submit record" })
        .isDisabled()
    );
    await reactPage.getByRole("button", { name: "Save draft" }).click();
    await reactPage.waitForFunction(
      () =>
        document.querySelector("[data-server-response]").textContent ===
        "Server committed draft."
    );
    check(
      "Express committed invalid correction draft",
      demo.saved.at(-1).action,
      "draft"
    );
    await reactPage.screenshot({
      path: path.join(out, "screenshots/07_react_express_record.png"),
      fullPage: true
    });
    await reactPage.getByLabel("Technician note").fill("Needs more detail");
    check(
      "React advisory warning",
      await reactPage.locator('[data-status="note"]').innerText(),
      "warning"
    );
    await reactPage.getByLabel("Measured pressure").fill("80");
    check(
      "React corrected dependent value",
      await reactPage.locator('[data-status="measured"]').innerText(),
      "valid"
    );
    check(
      "React advisory Submit remains available",
      await reactPage.getByRole("button", { name: "Submit record" }).isEnabled()
    );
    await reactPage.getByRole("button", { name: "Submit record" }).click();
    await reactPage.waitForFunction(
      () =>
        document.querySelector("[data-server-response]").textContent ===
        "Server committed submit."
    );
    check(
      "Express authoritative Submit committed",
      demo.saved.at(-1).action,
      "submit"
    );
    const forged = await reactPage.evaluate(async () => {
      const res = await fetch("/records/DEMO/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          formId: "react-express-demo",
          formVersion: 1,
          action: "submit",
          values: { limit: 90, measured: 95, note: "CHECKED" }
        })
      });
      return { status: res.status, body: await res.json() };
    });
    check("Express refuses bypass of disabled UI", forged.status, 422);
    check(
      "Express browser parity for dependent block",
      forged.body.evaluation.fields.measured.validationState,
      "blocking"
    );
    check("Rejected Submit makes no commit", demo.saved.length, 2);
  } finally {
    await reactPage.close();
    await new Promise((resolve) => demoServer.close(resolve));
  }
  check("no browser errors", errors, []);
} catch (error) {
  fatal = String(error.stack ?? error);
  console.error(fatal);
}
const report = {
  browser: await browser.version(),
  executable: process.env.DCMS_BROWSER_EXECUTABLE,
  playwrightModule: process.env.DCMS_PLAYWRIGHT_MODULE,
  htmlSha256: createHash("sha256").update(html).digest("hex"),
  checks,
  passed: checks.filter((x) => x.ok).length,
  failed: checks.filter((x) => !x.ok).length,
  errors,
  metrics,
  fatal
};
fs.writeFileSync(
  path.join(out, "BROWSER_RESULTS.json"),
  JSON.stringify(report, null, 2)
);
await browser.close();
console.log(
  JSON.stringify({
    passed: report.passed,
    failed: report.failed,
    fatal,
    metrics
  })
);
if (report.failed || fatal || errors.length) process.exitCode = 1;
