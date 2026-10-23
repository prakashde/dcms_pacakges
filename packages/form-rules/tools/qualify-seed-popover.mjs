/** Regression for the delivered HTML's Seed Data panel. Real browser geometry
 * catches cropped controls; native clicks, download and file chooser cover use.
 * Usage: node tools/qualify-seed-popover.mjs <standalone.html> <evidence-dir>
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const file = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
fs.mkdirSync(out, { recursive: true });
const { chromium } = await import(
  pathToFileURL(process.env.DCMS_PLAYWRIGHT_MODULE)
);
const browser = await chromium.launch({
  executablePath: process.env.DCMS_BROWSER_EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const checks = [],
  layouts = [],
  errors = [];
const check = (name, actual, expected = true) => {
  assert.deepEqual(actual, expected, name);
  checks.push(name);
};

async function openSeed(page) {
  const close = page.locator(".toast.show .toast-close");
  if (await close.count()) {
    await close.click();
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector("#toast")).opacity === "0"
    );
  }
  if (!(await page.locator("#seedMenu").evaluate((el) => el.open))) {
    await page.locator("#seedMenu summary").click();
  }
}

async function inspectLayout(page, name) {
  const geometry = await page.locator(".seed-popover").evaluate((panel) => {
    const r = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const left = r.left + panel.clientLeft + parseFloat(style.paddingLeft);
    const right =
      r.left +
      panel.clientLeft +
      panel.clientWidth -
      parseFloat(style.paddingRight);
    return {
      width: innerWidth,
      height: innerHeight,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      clientWidth: panel.clientWidth,
      scrollWidth: panel.scrollWidth,
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
      controls: [
        ...panel.querySelectorAll("input:not([type=file]),select,button")
      ].map((el) => {
        const b = el.getBoundingClientRect();
        return {
          id: el.id,
          fits: b.left >= left - 1 && b.right <= right + 1,
          width: b.width,
          height: b.height
        };
      })
    };
  });
  layouts.push({ name, ...geometry });
  check(
    `${name}: no horizontal scrollbar`,
    geometry.scrollWidth <= geometry.clientWidth + 1
  );
  check(
    `${name}: panel inside viewport`,
    geometry.left >= 0 &&
      geometry.right <= geometry.width &&
      geometry.top >= 0 &&
      geometry.bottom <= geometry.height
  );
  check(
    `${name}: all eight controls present`,
    geometry.controls.map((x) => x.id),
    [
      "revisionSeedInput",
      "revisionSeedSelect",
      "allowSeedReplace",
      "loadRevisionSeedBtn",
      "exportSeedJsonBtn",
      "importSeedJsonBtn",
      "recordSeedSelect",
      "loadRecordSeedBtn"
    ]
  );
  check(
    `${name}: controls are not clipped or collapsed`,
    geometry.controls.every((x) => x.fits && x.width >= 14 && x.height >= 14)
  );
  return geometry;
}

let failure;
try {
  for (const [width, height] of [
    [1440, 1000],
    [1024, 768],
    [820, 605],
    [429, 605],
    [320, 480],
    [1024, 320]
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(pathToFileURL(file).href);
    await openSeed(page);
    const label = `${width}x${height}`;
    await inspectLayout(page, label);
    // Every option contributes to a select's intrinsic size, including unselected
    // long labels. Also test each selected label rather than a single short case.
    const profiles = await page
      .locator("#revisionSeedSelect option")
      .evaluateAll((els) => els.map((x) => x.value));
    check(`${label}: all 14 profiles available`, profiles.length, 14);
    for (const profile of profiles) {
      await page.locator("#revisionSeedSelect").selectOption(profile);
      await inspectLayout(page, `${label}/${profile}`);
    }
    await page
      .locator("#revisionSeedSelect")
      .selectOption("incoming-inspection");
    await page.locator(".seed-popover").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({ path: path.join(out, `seed-${label}.png`) });
    await page.locator("#allowSeedReplace").uncheck();
    check(
      `${label}: replacement checkbox can be toggled`,
      await page.locator("#allowSeedReplace").isChecked(),
      false
    );
    await page.locator("#allowSeedReplace").check();
    await page.locator("#revisionSeedInput").fill("seed-panel-regression");
    await page.locator("#loadRevisionSeedBtn").click();
    check(
      `${label}: replace loads the chosen profile and seed`,
      await page.evaluate(() => [
        DCMSPrototype.state.revision.profile,
        DCMSPrototype.state.revision.seed
      ]),
      ["incoming-inspection", "seed-panel-regression"]
    );
    const definitions = await page.evaluate(() =>
      DCMSPrototype.state.revision.nodes.map((n) => n.definition)
    );
    await openSeed(page);
    await page.locator("#recordSeedSelect").selectOption("blocking");
    await page.locator("#loadRecordSeedBtn").click();
    check(
      `${label}: bottom action changes Record values`,
      await page.evaluate(() => [
        DCMSPrototype.state.recordSeedProfile,
        DCMSPrototype.state.revision.nodes.some(
          (n) =>
            JSON.stringify([...n.entered]) !==
            JSON.stringify([...n.originalEntered])
        )
      ]),
      ["blocking", true]
    );
    check(
      `${label}: Record seeding leaves definitions clean`,
      await page.evaluate(() =>
        DCMSPrototype.state.revision.nodes.every((n) => !n.dirty)
      )
    );
    check(
      `${label}: Record seeding preserves authored rules`,
      await page.evaluate(() =>
        DCMSPrototype.state.revision.nodes.map((n) => n.definition)
      ),
      definitions
    );
    check(
      `${label}: active Form keeps its new values`,
      await page.evaluate(() => [
        DCMSPrototype.state.activeNodeId,
        DCMSPrototype.state.entered.get("diameter_measured_mm"),
        DCMSPrototype.state.revision.nodes[0].entered.get(
          "diameter_measured_mm"
        )
      ]),
      ["incoming-1", 10, 10]
    );
    check(
      `${label}: editor displays the new Record value`,
      await page.locator('[data-value-id="diameter_measured_mm"]').inputValue(),
      "10"
    );
    await openSeed(page);
    await page.locator("#recordSeedSelect").selectOption("seeded");
    await page.locator("#loadRecordSeedBtn").click();
    check(
      `${label}: seeded values restore the original Records`,
      await page.evaluate(() =>
        DCMSPrototype.state.revision.nodes.every(
          (n) =>
            JSON.stringify([...n.entered]) ===
            JSON.stringify([...n.originalEntered])
        )
      )
    );
    await openSeed(page);
    // Verify bottom controls remain reachable by vertical scrolling at short heights.
    await page.locator("#loadRecordSeedBtn").scrollIntoViewIfNeeded();
    await inspectLayout(page, `${label}/scrolled`);
    if (height <= 480)
      await page.screenshot({
        path: path.join(out, `seed-${label}-scrolled.png`)
      });
    if (width === 429) {
      const before = await page.evaluate(
        () => DCMSPrototype.createSeedPackage().revision
      );
      const downloadEvent = page.waitForEvent("download");
      await page.locator("#exportSeedJsonBtn").click();
      const download = await downloadEvent;
      const jsonFile = path.join(out, "exported-seed.json");
      await download.saveAs(jsonFile);
      const exported = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
      check(
        "Export button downloads the full current Revision",
        exported.revision,
        before
      );
      check(
        "Export has the supported seed schema",
        [exported.schema, exported.schemaVersion],
        ["dcms-form-validation-seed", 1]
      );
      await openSeed(page);
      await page.locator("#revisionSeedSelect").selectOption("simple3");
      await page.locator("#loadRevisionSeedBtn").click();
      check(
        "A different Revision is loaded before import",
        await page.evaluate(() => DCMSPrototype.state.revision.profile),
        "simple3"
      );
      await openSeed(page);
      await page.locator("#exportSeedJsonBtn").focus();
      await page.keyboard.press("Tab");
      check(
        "Import button reachable by keyboard",
        await page.evaluate(() => document.activeElement.id),
        "importSeedJsonBtn"
      );
      const chooserEvent = page.waitForEvent("filechooser");
      await page.locator("#importSeedJsonBtn").click();
      await (await chooserEvent).setFiles(jsonFile);
      await page.waitForFunction(
        () => DCMSPrototype.state.revision.profile === "imported"
      );
      const imported = await page.evaluate(
        () => DCMSPrototype.createSeedPackage().revision
      );
      check(
        "Import button restores the exported definition and Records",
        imported,
        { ...before, profile: "imported" }
      );
    }
    await page.close();
  }
  check("No browser runtime or console errors", errors, []);
} catch (error) {
  failure = error;
} finally {
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        file,
        passed: checks.length,
        checks,
        layouts,
        errors,
        ...(failure ? { failure: String(failure) } : {})
      },
      null,
      2
    )
  );
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks.length, layouts: layouts.length }));
