/** Follow the short HTML guide using the delivered file and actual input controls. */
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const file = path.resolve(process.argv[2]),
  out = path.resolve(process.argv[3]);
const { chromium } = await import(
  pathToFileURL(process.env.DCMS_PLAYWRIGHT_MODULE)
);
const browser = await chromium.launch({
  executablePath: process.env.DCMS_BROWSER_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const checks = [],
  check = (name, actual, expected) => {
    assert.deepEqual(actual, expected, name);
    checks.push(name);
  };
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1100 }
  });
  await page.goto(pathToFileURL(file).href);
  await page.waitForFunction(() => !!window.DCMSPrototype);
  await page.locator("#seedMenu summary").click();
  const label = await page
    .locator('#revisionSeedSelect option[value="review-suite"]')
    .innerText();
  assert.ok(label.includes("Reviewed examples"));
  await page.locator("#revisionSeedSelect").selectOption("review-suite");
  await page.locator("#allowSeedReplace").check();
  await page.locator("#loadRevisionSeedBtn").click();
  await page
    .locator("[data-node-open]")
    .filter({ hasText: "Equipment commissioning release" })
    .click();
  check(
    "Equipment example selected",
    await page.evaluate(
      () =>
        DCMSPrototype.state.revision.nodes.find(
          (n) => n.nodeId === DCMSPrototype.state.activeNodeId
        ).title
    ),
    "Equipment commissioning release"
  );
  await page.locator("#submitRevisionGlobal").click();
  const state = () =>
    page.evaluate(() => {
      const n = DCMSPrototype.state.revision.nodes.find(
        (n) => n.title === "Equipment commissioning release"
      );
      return {
        canSubmit: n.evaluation.canSubmit,
        blocking: n.evaluation.blockingFieldIds,
        warning: n.evaluation.warningFieldIds
      };
    });
  check("Baseline ready", await state(), {
    canSubmit: true,
    blocking: [],
    warning: []
  });
  await page.locator('[data-inline-preview-id="measured"]').fill("103");
  check("Measurement blocks", await state(), {
    canSubmit: false,
    blocking: ["measured"],
    warning: []
  });
  await page.locator('[data-inline-preview-id="measured"]').fill("100.5");
  const safety = page.locator(
    '[data-inline-preview-id="checks"][value="E-stop tested"]'
  );
  await safety.uncheck();
  check("Missing safety selection blocks", await state(), {
    canSubmit: false,
    blocking: ["checks"],
    warning: []
  });
  await safety.check();
  await page.locator('[data-inline-preview-id="notes"]').fill("OK");
  check("Short note warns without blocking", await state(), {
    canSubmit: true,
    blocking: [],
    warning: ["notes"]
  });
  await page
    .locator("[data-inline-node]")
    .filter({ hasText: "Equipment commissioning release" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.locator('[data-validation="measured"]').click();
  check(
    "Rule editor labels",
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
  await page.locator("#modalSave").click();
  check(
    "Confirm closes a valid editor",
    await page
      .locator("#modalBackdrop")
      .evaluate((x) => x.classList.contains("show")),
    false
  );
  fs.writeFileSync(
    out,
    JSON.stringify({ file, passed: checks.length, checks }, null, 2)
  );
  console.log(JSON.stringify({ passed: checks.length }));
} finally {
  await browser.close();
}
