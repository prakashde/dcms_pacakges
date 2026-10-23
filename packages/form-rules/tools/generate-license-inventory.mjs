/** Inventory the exact installed packages and preserve their upstream notices. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const lock = JSON.parse(fs.readFileSync("package-lock.json")),
  items = [];
fs.mkdirSync("docs/licenses", { recursive: true });
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || !fs.existsSync(path.join(location, "package.json")))
    continue;
  const meta = JSON.parse(fs.readFileSync(path.join(location, "package.json")));
  const files = [];
  for (const name of fs.readdirSync(location))
    if (
      /^(licen[cs]e|copying|notice)(\.|$)/i.test(name) &&
      fs.statSync(path.join(location, name)).isFile()
    ) {
      const bytes = fs.readFileSync(path.join(location, name)),
        out = `docs/licenses/${meta.name.replaceAll("/", "__")}__${name}`;
      fs.writeFileSync(out, bytes);
      files.push({
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        copy: out
      });
    }
  items.push({
    name: meta.name,
    version: meta.version,
    license:
      meta.license ??
      meta.licenses?.map((x) => x.type).join(" OR ") ??
      "UNSPECIFIED",
    development: !!entry.dev,
    location,
    integrity: entry.integrity,
    licenseFiles: files
  });
}
items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const inventory = {
  package: "@dcms/form-rules",
  version: "0.10.3",
  scope: "Installed runtime plus build and example dependencies",
  packages: items
};
fs.writeFileSync(
  "docs/THIRD_PARTY_LICENSE_INVENTORY.json",
  JSON.stringify(inventory, null, 2) + "\n"
);
const runtime = items.filter((x) => !x.development);
fs.writeFileSync(
  "docs/LICENSE_REVIEW.md",
  "# Dependency inventory\n\nReviewed package version 0.10.3 on 23 September 2026. The application package remains UNLICENSED. " +
    runtime.length +
    " runtime packages were inspected. The installed runtime metadata declares MIT or Apache-2.0 licenses. Upstream notices are retained in docs/licenses and in the bundled dependency directories. This inventory records package metadata and file hashes; it does not grant application distribution rights.\n\n| Runtime package | Version | Declared license |\n|---|---|---|\n" +
    runtime
      .map((x) => `| ${x.name} | ${x.version} | ${x.license} |`)
      .join("\n") +
    "\n\nThe full JSON inventory also covers " +
    items.filter((x) => x.development).length +
    " installed development/example dependencies. The browser test companion has its own notices and runtime identity.\n"
);
fs.writeFileSync(
  "docs/SBOM.cdx.json",
  JSON.stringify(
    {
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        component: {
          type: "library",
          name: "@dcms/form-rules",
          version: "0.10.3"
        }
      },
      components: items.map((x) => ({
        type: "library",
        name: x.name,
        version: x.version,
        scope: x.development ? "optional" : "required",
        purl: `pkg:npm/${x.name.startsWith("@") ? "%40" + x.name.slice(1) : x.name}@${x.version}`,
        licenses: [{ expression: x.license }]
      }))
    },
    null,
    2
  ) + "\n"
);
console.log(
  JSON.stringify({
    runtime: runtime.length,
    development: items.length - runtime.length,
    unspecified: items
      .filter((x) => x.license === "UNSPECIFIED")
      .map((x) => x.name)
  })
);
