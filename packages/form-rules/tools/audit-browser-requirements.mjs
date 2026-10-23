/** Real DOM acceptance checks for the reference editor, with independent saved/working-state assertions. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = process.cwd(),
  version = JSON.parse(fs.readFileSync("package.json")).version;
const out = path.resolve(
  process.env.DCMS_BROWSER_EVIDENCE ?? "evidence/browser-audit"
);
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(
  pathToFileURL(process.env.DCMS_PLAYWRIGHT_MODULE)
);
const browser = await chromium.launch({
  executablePath: process.env.DCMS_BROWSER_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }),
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const check = (name, actual, expected = true) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, ...(ok ? {} : { actual, expected }) });
  if (!ok) console.error(name, actual, expected);
};
const load = () =>
  page.evaluate(() =>
    DCMSPrototype.loadRevisionSeed("validation-atlas", "Test audit", {
      force: true
    })
  );
const open = (id) => page.locator(`[data-validation="${id}"]`).click();
const snapshot = () =>
  page.evaluate(() => {
    const s = DCMSPrototype.state,
      n = s.revision.nodes[0];
    return {
      definition: JSON.stringify(s.definition),
      ui: JSON.stringify(s.uiFields),
      saved: JSON.stringify(n.savedSnapshot),
      dirty: n.dirty
    };
  });
const html = path.join(
  root,
  `reference-ui/DCMS_Form_Rules_Review_Workbench_v${version}.html`
);
let fatal;
try {
  await page.goto(pathToFileURL(html).href);
  await page.waitForFunction(() => !!window.DCMSPrototype);
  await load();
  check(
    "B01 Form editor contains configured field rows",
    await page.locator("#formRows [data-validation]").count(),
    await page.evaluate(() => DCMSPrototype.state.definition.fields.length)
  );
  const before = await snapshot();
  await open("atlas_num_001");
  check(
    "B29 dialog prepopulates field category and label",
    [
      await page.locator("#modalCategory").inputValue(),
      await page.locator("#modalLabel").inputValue()
    ],
    [
      "Number",
      JSON.parse(before.definition).fields.find((f) => f.id === "atlas_num_001")
        .label
    ]
  );
  check(
    "B30 dialog provides required rule columns",
    await page.locator(".rule-table th").allTextContents(),
    [
      "Operator",
      "Optional Expression",
      "Criteria",
      "Keyword",
      "Case Sensitive",
      "Delete"
    ]
  );
  check(
    "B02 dialog action is Confirm",
    await page.locator("#modalSave").innerText(),
    "Confirm"
  );
  await page.locator("#modalLabel").fill("Unconfirmed label");
  await page.locator("#modalCategory").selectOption("Text");
  await page.locator('[data-rule-keyword="0"]').fill("CANCELLED");
  await page.locator("#modalX").click();
  check(
    "B03 cancel preserves working Form and saved snapshot",
    await snapshot(),
    before
  );
  await open("atlas_num_001");
  await page.locator("#modalLabel").fill("Confirmed label");
  await page.locator("#modalSave").click();
  const confirmed = await snapshot();
  check(
    "B04 Confirm updates working label",
    await page.evaluate(
      () =>
        DCMSPrototype.state.definition.fields.find(
          (f) => f.id === "atlas_num_001"
        ).label
    ),
    "Confirmed label"
  );
  check(
    "B05 Confirm does not change saved snapshot",
    confirmed.saved,
    before.saved
  );
  check("B06 Confirm marks Form dirty", confirmed.dirty);
  await page.locator("#saveDefinitionBtn").click();
  const saved = await snapshot();
  check(
    "B07 Save Form captures confirmed definition",
    JSON.parse(saved.saved).definition,
    JSON.parse(saved.definition)
  );
  check("B08 Save Form clears dirty flag", saved.dirty, false);
  await load();
  await open("atlas_num_001");
  const lists = {
    Number: [
      "required_keywords",
      "character_limit_less_than",
      "character_limit_more_than",
      "character_limit_equal_to",
      "number_greater_than",
      "number_less_than",
      "number_equal_to"
    ],
    Text: [
      "required_keywords",
      "character_limit_less_than",
      "character_limit_more_than",
      "character_limit_equal_to"
    ],
    "Rich Text": [
      "required_keywords",
      "character_limit_less_than",
      "character_limit_more_than",
      "character_limit_equal_to"
    ],
    Radio: [
      "required_keywords",
      "selection_values_include",
      "selection_values_exclude"
    ],
    Checkbox: [
      "required_keywords",
      "selection_values_include_any",
      "selection_values_include_all",
      "selection_values_exclude_any",
      "selection_values_exclude_all"
    ]
  };
  for (const [category, expected] of Object.entries(lists)) {
    await page.locator("#modalCategory").selectOption(category);
    check(
      "B09 criteria for " + category,
      await page
        .locator('[data-rule-criteria="0"] option')
        .evaluateAll((els) => els.map((x) => x.value)),
      expected
    );
  }
  check(
    "B10 first operator is disabled",
    await page.locator('[data-rule-op="0"]').isDisabled()
  );
  await page.locator("#modalAddRow").click();
  check(
    "B11 subsequent operator choices",
    await page.locator('[data-rule-op="1"] option').allTextContents(),
    ["AND", "OR", "AND NOT", "OR NOT"]
  );
  check(
    "B12 subsequent operator is enabled",
    await page.locator('[data-rule-op="1"]').isEnabled()
  );
  await page.locator("#modalX").click();
  await load();
  await open("atlas_num_001");
  const badBefore = await snapshot();
  await page.locator('[data-rule-expression="0"]').fill("1+");
  await page.locator("#modalSave").click();
  check(
    "B13 invalid formula keeps dialog open",
    await page
      .locator("#modalBackdrop")
      .evaluate((x) => x.classList.contains("show"))
  );
  check(
    "B14 rejected formula leaves definition unchanged",
    (await snapshot()).definition,
    badBefore.definition
  );
  check(
    "B15 rejection explains the actual parser error",
    !(await page.locator("#modalSummary").innerText()).includes("Unknown error")
  );
  await page.screenshot({
    path: path.join(out, "invalid-formula.png"),
    fullPage: true
  });
  await page.locator("#modalX").click();
  await load();
  await open("atlas_num_001");
  const n = await page.locator("[data-rule-row]").count();
  for (let i = 0; i < n; i++)
    await page.locator('[data-rule-delete="0"]').click();
  check(
    "B16 deleting last row leaves zero working rows",
    await page.locator("[data-rule-row]").count(),
    0
  );
  await page.locator("#modalSave").click();
  check(
    "B17 deleting last row updates rule count to zero",
    await page.locator('[data-validation="atlas_num_001"]').innerText(),
    "+ Validation Rule (0)"
  );
  check(
    "B18 field without rules is unvalidated",
    await page.evaluate(
      () =>
        DCMSPrototype.state.evaluation.values.get("atlas_num_001")
          .validationState
    ),
    "not_validated"
  );
  await load();
  await open("atlas_num_001");
  await page.locator("#modalDelete").click();
  check(
    "B19 Delete All sets rule count to zero",
    await page.locator('[data-validation="atlas_num_001"]').innerText(),
    "+ Validation Rule (0)"
  );
  await open("atlas_num_001");
  for (let i = 0; i < 3; i++) await page.locator("#modalAddRow").click();
  const ids = await page.evaluate(() =>
    DCMSPrototype.state.modalWorkingRows.map((r) => r.id)
  );
  await page.locator('[data-rule-delete="1"]').click();
  check(
    "B20 deleting middle row preserves remaining order",
    await page.evaluate(() =>
      DCMSPrototype.state.modalWorkingRows.map((r) => r.id)
    ),
    [ids[0], ids[2]]
  );
  await page.locator("#modalAddRow").click();
  check(
    "B21 insert after deletion allocates a unique stable row ID",
    await page.evaluate(() => {
      const rows = DCMSPrototype.state.modalWorkingRows;
      return new Set(rows.map((r) => r.id)).size === rows.length;
    })
  );
  await page.locator("#modalSave").click();
  check(
    "B22 valid inserted rows can be confirmed",
    await page
      .locator("#modalBackdrop")
      .evaluate((x) => !x.classList.contains("show"))
  );
  if (
    await page
      .locator("#modalBackdrop")
      .evaluate((x) => x.classList.contains("show"))
  )
    await page.locator("#modalX").click();
  await load();
  check(
    "B27 reloading the same seed replaces previous edits",
    await page.evaluate(
      () =>
        DCMSPrototype.state.definition.fields.find(
          (f) => f.id === "atlas_num_001"
        ).validationRows.length
    ),
    2
  );
  await open("atlas_num_001");
  if (!(await page.locator("[data-rule-row]").count()))
    await page.locator("#modalAddRow").click();
  await page.locator("#modalCategory").selectOption("Text");
  await page
    .locator('[data-rule-criteria="0"]')
    .selectOption("required_keywords");
  await page.locator('[data-rule-keyword="0"]').fill("ALPHA BETA");
  check(
    "B23 implicit OR shows a nonblocking authoring warning",
    (await page.locator('[data-rule-keydiag="0"]').innerText()).includes("OR")
  );
  await page.locator('[data-rule-case="0"]').check();
  await page.screenshot({
    path: path.join(out, "keyword-warning.png"),
    fullPage: true
  });
  await page.locator("#modalSave").click();
  check(
    "B24 warning does not prevent Confirm",
    await page
      .locator("#modalBackdrop")
      .evaluate((x) => !x.classList.contains("show"))
  );
  check(
    "B25 case setting survives Confirm",
    await page.evaluate(
      () =>
        DCMSPrototype.state.definition.fields.find(
          (f) => f.id === "atlas_num_001"
        ).validationRows[0].caseSensitive
    )
  );
  const imported = await page.evaluate(() => {
    const P = DCMSPrototype,
      seed = P.createSeedPackage(),
      n = seed.revision.nodes[0];
    n.definition.fields.find((f) => f.id === "atlas_num_001").label =
      "Imported replacement";
    n.uiFields.find((f) => f.id === "atlas_num_001").label =
      "Imported replacement";
    P.importSeedObject(seed, { force: true });
    return P.state.definition.fields.find((f) => f.id === "atlas_num_001")
      .label;
  });
  check(
    "B28 import with the same node ID replaces previous edits",
    imported,
    "Imported replacement"
  );
  check("B26 no browser execution errors", errors, []);
} catch (e) {
  fatal = String(e.stack ?? e);
  console.error(fatal);
}
const report = {
  version,
  browser: await browser.version(),
  htmlSha256: createHash("sha256").update(fs.readFileSync(html)).digest("hex"),
  checks,
  passed: checks.filter((x) => x.ok).length,
  failed: checks.filter((x) => !x.ok).length,
  errors,
  fatal
};
fs.writeFileSync(
  path.join(out, "BROWSER_AUDIT.json"),
  JSON.stringify(report, null, 2)
);
await browser.close();
console.log(
  JSON.stringify({ passed: report.passed, failed: report.failed, fatal })
);
if (fatal || report.failed || errors.length) process.exitCode = 1;
