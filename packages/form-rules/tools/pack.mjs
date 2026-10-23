/** Pack the qualified runtime tree. Root overrides do not propagate from a dependency to consumers. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd(),
  stage = path.join(root, ".pack-stage"),
  out = path.join(root, "release");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage);
fs.mkdirSync(out, { recursive: true });
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const item of pkg.files) {
  if (!fs.existsSync(item))
    throw new Error(
      `Missing package input ${item}. Run npm run verify before packing.`
    );
  fs.cpSync(item, path.join(stage, item), { recursive: true });
}
const runtime = JSON.parse(
  execFileSync("npm", ["ls", "--omit=dev", "--all", "--json"], {
    encoding: "utf8"
  })
);
const names = new Set();
const visit = (deps) => {
  for (const [name, dep] of Object.entries(deps ?? {})) {
    if (dep.extraneous) continue;
    names.add(name);
    visit(dep.dependencies);
  }
};
visit(runtime.dependencies);
for (const name of names)
  fs.cpSync(
    path.join("node_modules", name),
    path.join(stage, "node_modules", name),
    { recursive: true }
  );
const patches = [];
for (const name of names) {
  const file = path.join(stage, "node_modules", name, "package.json"),
    before = fs.readFileSync(file),
    meta = JSON.parse(before);
  if (
    meta.dependencies?.lodash &&
    meta.dependencies.lodash !== pkg.dependencies.lodash
  ) {
    const previous = meta.dependencies.lodash;
    meta.dependencies.lodash = pkg.dependencies.lodash;
    meta.dcmsPackagingNotice = `DCMS ${pkg.version} changed only the Lodash dependency declaration to match the qualified bundled override. Upstream implementation source is unchanged.`;
    const after = JSON.stringify(meta, null, 2) + "\n";
    fs.writeFileSync(file, after);
    patches.push({
      package: name,
      version: meta.version,
      file: "package.json",
      from: previous,
      to: pkg.dependencies.lodash,
      beforeSha256: createHash("sha256").update(before).digest("hex"),
      afterSha256: createHash("sha256").update(after).digest("hex")
    });
  }
}
fs.writeFileSync(
  path.join(stage, "DCMS_DEPENDENCY_METADATA_PATCHES.json"),
  JSON.stringify(patches, null, 2) + "\n"
);
pkg.files.push("DCMS_DEPENDENCY_METADATA_PATCHES.json");
pkg.bundledDependencies = Object.keys(pkg.dependencies);
// Source development overrides remain in package-lock. Shipping the resolved tree makes the TGZ offline-installable.
delete pkg.overrides;
delete pkg.devDependencies;
delete pkg.scripts;
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(pkg, null, 2) + "\n"
);
const result = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", out],
    { cwd: stage, encoding: "utf8" }
  )
);
console.log(JSON.stringify(result, null, 2));
