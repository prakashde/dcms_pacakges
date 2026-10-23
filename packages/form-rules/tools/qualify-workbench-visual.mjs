/** Visual/interaction regressions against the delivered standalone HTML.
 * Usage: node tools/qualify-workbench-visual.mjs <html> <evidence-directory>
 * Screenshots supplement geometry, actual pointer actions and independent data checks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const file = path.resolve(process.argv[2]),
  out = path.resolve(process.argv[3]);
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
  errors = [],
  groups = [];
function check(name, actual, expected = true) {
  try {
    assert.deepEqual(actual, expected);
    checks.push({ name, ok: true });
  } catch {
    checks.push({ name, ok: false, actual, expected });
  }
}
async function dismiss(page) {
  const close = page.locator(".toast.show .toast-close");
  if (await close.count()) await close.click();
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector("#toast")).opacity === "0"
  );
}
async function load(page, profile) {
  await page.evaluate(
    (profile) =>
      DCMSPrototype.loadRevisionSeed(profile, "visual-regression", {
        force: true
      }),
    profile
  );
  await dismiss(page);
  await page.evaluate(() => scrollTo(0, 0));
}
async function snap(page, name) {
  await dismiss(page);
  await page.screenshot({ path: path.join(out, name + ".png") });
}
async function fits(page, selector) {
  return page
    .locator(selector)
    .evaluateAll((els) =>
      els.every((el) => el.scrollWidth <= el.clientWidth + 1)
    );
}
async function headerFits(page) {
  return page.evaluate(() => {
    const title = document
      .querySelector(".header-title")
      .getBoundingClientRect();
    const left = document.querySelector(".header-left").getBoundingClientRect();
    const right = document
      .querySelector(".header-actions")
      .getBoundingClientRect();
    return (
      title.left >= left.right - 1 &&
      title.right <= right.left + 1 &&
      right.right <= innerWidth
    );
  });
}
async function recordSeed(page, profile) {
  await dismiss(page);
  await page.locator("#seedMenu summary").click();
  await page.locator("#recordSeedSelect").selectOption(profile);
  await page.locator("#loadRecordSeedBtn").click();
  await dismiss(page);
}
const plain = (text) => text.replace(/\s+/g, " ").trim();
let fatal;
try {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [820, 605],
    [820, 400]
  ]) {
    const key = `${width}x${height}`;
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(pathToFileURL(file).href);

    // Ordinary supplied Forms retain their editor, Preview and review geometry.
    for (const profile of [
      "incoming-inspection",
      "stress-edge",
      "review-suite"
    ]) {
      await load(page, profile);
      check(
        `${key}/${profile}: header does not overlap actions`,
        await headerFits(page)
      );
      await snap(page, `${key}-${profile}-editor`);
      await page.locator("#previewBtn").click();
      check(
        `${key}/${profile}: Preview descriptions fit`,
        await fits(
          page,
          ".preview-document-description,.preview-record-description"
        )
      );
      await snap(page, `${key}-${profile}-preview`);
      await page.locator("#submitRevisionGlobal").click();
      check(
        `${key}/${profile}: review content fits`,
        await fits(
          page,
          ".revision-form-title,.revision-preview-document,.revision-preview-record,.preview-label,.choice-row"
        )
      );
      await snap(page, `${key}-${profile}-review`);
    }

    await load(page, "stress-edge");
    const description = (
      "Inspection instructions. " +
      "BatchIdentifier".repeat(10) +
      "\n"
    )
      .repeat(12)
      .trimEnd();
    await page.locator("#docDescription .rich-content").fill(description);
    const descriptionScroll = await page
      .locator("#docDescription .rich-content")
      .evaluate((el) => {
        const height = el.getBoundingClientRect().height;
        el.scrollTop = el.scrollHeight;
        return {
          scrolls: el.scrollTop > 0,
          stableHeight: el.getBoundingClientRect().height === height,
          horizontal: el.scrollWidth <= el.clientWidth + 1
        };
      });
    check(
      `${key}: long description scrolls within its own editor`,
      descriptionScroll,
      { scrolls: true, stableHeight: true, horizontal: true }
    );
    check(
      `${key}: complete description retained`,
      await page.evaluate(
        () => DCMSPrototype.state.revision.nodes[0].docDescription
      ),
      description
    );
    await snap(page, `${key}-long-description`);

    await load(page, "stress-edge");
    await page.locator("#previewBtn").click();
    const narrative = page.locator('[data-preview-id="long_narrative"]');
    check(
      `${key}: long Preview text uses a multiline control`,
      await narrative.evaluate((el) => el.tagName),
      "TEXTAREA"
    );
    check(
      `${key}: full-width Preview text`,
      await narrative.evaluate(
        (el) =>
          el.getBoundingClientRect().width >=
          el.closest(".preview-field").clientWidth - 12
      )
    );
    check(
      `${key}: short text uses available width`,
      await page
        .locator('[data-preview-id="literal_regex_chars"]')
        .evaluate(
          (el) =>
            el.getBoundingClientRect().width >=
            el.closest(".preview-field").clientWidth - 12
        )
    );
    const originalNarrative = await narrative.inputValue();
    await narrative.fill("Missing the required token.");
    check(
      `${key}: multiline edits reach validation`,
      await page.evaluate(
        () =>
          DCMSPrototype.state.evaluation.values.get("long_narrative").blocking
      )
    );
    await narrative.fill(originalNarrative);
    check(
      `${key}: original long value restores validation`,
      await page.evaluate(
        () =>
          DCMSPrototype.state.evaluation.values.get("long_narrative").blocking
      ),
      false
    );
    await narrative.scrollIntoViewIfNeeded();
    await snap(page, `${key}-long-preview`);
    await page.locator('[name="previewVersion"][value="original"]').check();
    check(
      `${key}: original long value is readonly`,
      await page
        .locator('[data-preview-id="long_narrative"]')
        .evaluate((el) => el.readOnly)
    );

    await load(page, "simple3");
    await page.locator("#previewBtn").click();
    await page.locator('[name="previewVersion"][value="original"]').check();
    const choice = page.locator('[data-preview-id][type="checkbox"]').first();
    const originalChoice = await choice.isChecked();
    await choice.scrollIntoViewIfNeeded();
    const box = await choice.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    check(
      `${key}: View Original cannot be visually edited`,
      await choice.isChecked(),
      originalChoice
    );
    check(
      `${key}: all original choice controls are disabled`,
      await page
        .locator(
          '[data-preview-id][type="checkbox"],[data-preview-id][type="radio"]'
        )
        .evaluateAll((els) => els.length > 0 && els.every((el) => el.disabled))
    );
    await page.locator('[name="previewVersion"][value="new"]').check();
    const editable = page.locator('[data-preview-id][type="checkbox"]').first();
    await editable.click();
    check(
      `${key}: View New choice remains editable`,
      await editable.isChecked(),
      !originalChoice
    );

    await load(page, "stress-edge");
    const original = await page.evaluate(() => ({
      html: DCMSPrototype.state.uiFields.find(
        (f) => f.id === "rich_stress_edge"
      ).richHtml,
      value: DCMSPrototype.state.entered.get("rich_stress_edge"),
      definition: DCMSPrototype.state.definition
    }));
    await recordSeed(page, "blocking");
    await page.locator("#previewBtn").click();
    check(
      `${key}: rich Preview matches newly loaded Record`,
      await page.locator('[data-preview-id="rich_stress_edge"]').innerText(),
      "PASS LOT A123"
    );
    await page.locator("#submitRevisionGlobal").click();
    check(
      `${key}: rich review matches newly loaded Record`,
      await page
        .locator('[data-inline-preview-id="rich_stress_edge"]')
        .innerText(),
      "PASS LOT A123"
    );
    await recordSeed(page, "seeded");
    await page.locator("#previewBtn").click();
    check(
      `${key}: seed restore retains rich formatting`,
      await page.locator('[data-preview-id="rich_stress_edge"]').innerHTML(),
      original.html
    );
    check(
      `${key}: rich restore agrees with engine input`,
      plain(
        await page.locator('[data-preview-id="rich_stress_edge"]').innerText()
      ),
      plain(original.value)
    );
    const rich = page.locator('[data-preview-id="rich_stress_edge"]');
    await rich.fill("Changed narrative without required terms.");
    await page.locator(".prototype-panel summary").click();
    await page.locator("#restoreSeed").click();
    check(
      `${key}: current-Form restore refreshes visible rich text`,
      await rich.innerHTML(),
      original.html
    );
    await page.locator(".prototype-panel summary").click();
    await page.locator("#loadValid").click();
    check(
      `${key}: current-Form values refresh rich text`,
      await rich.innerText(),
      "PASS LOT A123"
    );
    check(
      `${key}: Record display updates preserve authored rules`,
      await page.evaluate(() => DCMSPrototype.state.definition),
      original.definition
    );
    await rich.scrollIntoViewIfNeeded();
    await snap(page, `${key}-rich-record-values`);

    // Long imported identifiers and labels exercise min-content sizes, not only
    // ordinary strings containing convenient word-break opportunities.
    await load(page, "simple3");
    const longTitle = "LOT-" + "X".repeat(140),
      longText = "BATCH-" + "Y".repeat(400);
    await page.evaluate(
      ({ longTitle, longText }) => {
        const seed = DCMSPrototype.createSeedPackage();
        const n = seed.revision.nodes[0];
        n.title = longTitle;
        n.docDescription = longText;
        n.recordDescription = longText;
        n.uiFields[0].label = longText;
        n.definition.fields[0].label = longText;
        DCMSPrototype.importSeedObject(seed, { force: true });
      },
      { longTitle, longText }
    );
    check(
      `${key}: long title leaves header buttons accessible`,
      await headerFits(page)
    );
    check(
      `${key}: full title is available`,
      await page.locator(".header-title").getAttribute("title"),
      longTitle
    );
    check(`${key}: sidebar titles wrap`, await fits(page, ".node-name"));
    await snap(page, `${key}-long-title-editor`);
    await page
      .locator("#docDescription .rich-content")
      .fill(longText + " updated");
    await page.locator('[data-node-open="form-2"]').click();
    check(`${key}: long notification fits`, await fits(page, ".toast-message"));
    check(
      `${key}: notification stays within viewport`,
      await page.locator("#toast").evaluate((el) => {
        const b = el.getBoundingClientRect();
        return (
          b.left >= 0 &&
          b.right <= innerWidth &&
          b.top >= 0 &&
          b.bottom <= innerHeight
        );
      })
    );
    await dismiss(page);
    await page.locator('[data-node-open="form-1"]').click();
    await page.locator("#submitRevisionGlobal").click();
    check(
      `${key}: long review text and labels wrap`,
      await fits(
        page,
        ".revision-form-title,.revision-preview-document,.revision-preview-record,.preview-label"
      )
    );
    await snap(page, `${key}-long-title-review`);

    await load(page, "validation-atlas");
    await page.locator('[data-validation="atlas_num_001"]').click();
    await page
      .locator('[data-rule-expression="0"]')
      .fill("=UNKNOWN_" + "X".repeat(240) + "(VALUE)");
    await page.locator("#modalSave").click();
    check(
      `${key}: rejected formula stays open with explanation`,
      await page
        .locator("#modalSummary")
        .innerText()
        .then((s) => s.includes("Unknown formula function"))
    );
    await page.locator("#modalSummary").scrollIntoViewIfNeeded();
    check(
      `${key}: error message wraps inside the dialog`,
      await fits(page, "#modalSummary,.modal-content")
    );
    check(
      `${key}: dialog footer remains visible`,
      await page.locator("#modalSave").evaluate((el) => {
        const b = el.getBoundingClientRect();
        return b.top >= 0 && b.bottom <= innerHeight;
      })
    );
    await snap(page, `${key}-rule-error`);
    // Horizontal rule-table scrolling is intentional; confirm the final columns
    // are reachable and actionable without scrolling the entire dialog sideways.
    await page.locator('[data-rule-case="0"]').check();
    check(
      `${key}: far-right rule control remains usable`,
      await page.locator('[data-rule-case="0"]').isChecked()
    );
    await snap(page, `${key}-rule-last-columns`);
    await page.locator("#modalX").click();
    await page.locator(".prototype-panel summary").click();
    await page.locator(".prototype-panel").scrollIntoViewIfNeeded();
    check(
      `${key}: evidence controls fit`,
      await fits(page, ".prototype-grid,.evidence-cards,.prototype-actions")
    );
    await snap(page, `${key}-evidence`);
    groups.push(key);
    await page.close();
  }
  const small = await browser.newPage({
    viewport: { width: 429, height: 605 }
  });
  await small.goto(pathToFileURL(file).href);
  await load(small, "validation-atlas");
  await small.locator('[data-validation="atlas_num_001"]').click();
  check(
    "429px: dialog context controls fit",
    await fits(small, ".modal-context,.modal-content")
  );
  await small.locator("#modalLabel").fill("Narrow window edit");
  await small.locator('[data-rule-case="0"]').check();
  await small.locator("#modalSave").click();
  check(
    "429px: dialog Confirm applies the edit",
    await small.evaluate(
      () =>
        DCMSPrototype.state.definition.fields.find(
          (f) => f.id === "atlas_num_001"
        ).label
    ),
    "Narrow window edit"
  );
  await small.close();
  check("No browser errors", errors, []);
} catch (e) {
  fatal = String(e.stack ?? e);
} finally {
  await browser.close();
  const report = {
    file,
    groups,
    passed: checks.filter((c) => c.ok).length,
    failed: checks.filter((c) => !c.ok).length,
    checks,
    errors,
    fatal
  };
  fs.writeFileSync(
    path.join(out, "results.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(
    JSON.stringify({ passed: report.passed, failed: report.failed, fatal })
  );
  if (fatal || report.failed || errors.length) process.exitCode = 1;
}
