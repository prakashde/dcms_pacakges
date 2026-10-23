/**
 * Pack the byte-preserved @dcms/form-rules workspace from a hoisted npm install.
 *
 * The package-owned packer was authored for a standalone checkout where
 * process.cwd()/node_modules contains the package runtime tree. In this monorepo,
 * npm hoists that tree to the workspace root. This wrapper reproduces the same
 * staged package contract without editing the qualified 0.10.5 engine baseline.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineRoot = path.join(root, "packages/form-rules");
const out = path.join(root, "artifacts");
const pkg = JSON.parse(
  fs.readFileSync(path.join(engineRoot, "package.json"), "utf8")
);
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dcms-engine-pack-"));
const stage = path.join(stageRoot, "package");

function findInstalledPackage(startDir, name) {
  let cursor = path.resolve(startDir);
  const segments = name.split("/");
  while (true) {
    const candidate = path.join(cursor, "node_modules", ...segments);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function collectRuntimeClosure() {
  const queue = Object.keys(pkg.dependencies ?? {}).map((name) => ({
    name,
    parent: engineRoot
  }));
  const byName = new Map();
  while (queue.length) {
    const { name, parent } = queue.shift();
    const installed = findInstalledPackage(parent, name);
    if (!installed)
      throw new Error(`Missing installed runtime dependency ${name}`);
    const meta = JSON.parse(
      fs.readFileSync(path.join(installed, "package.json"), "utf8")
    );
    const prior = byName.get(name);
    if (prior) {
      if (prior.version !== meta.version || prior.path !== installed) {
        throw new Error(
          `Runtime closure needs multiple ${name} installations (${prior.version}, ${meta.version}); ` +
            "the standalone 0.10.5 pack contract cannot flatten that tree safely."
        );
      }
      continue;
    }
    byName.set(name, { name, version: meta.version, path: installed });
    const children = {
      ...(meta.dependencies ?? {}),
      ...(meta.optionalDependencies ?? {})
    };
    for (const child of Object.keys(children)) {
      const childPath = findInstalledPackage(installed, child);
      if (childPath) queue.push({ name: child, parent: installed });
    }
  }
  return [...byName.values()];
}

try {
  fs.mkdirSync(stage, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  for (const item of pkg.files) {
    const source = path.join(engineRoot, item);
    if (!fs.existsSync(source)) {
      throw new Error(
        `Missing package input ${item}. Run npm run verify:engine before packing.`
      );
    }
    fs.cpSync(source, path.join(stage, item), { recursive: true });
  }

  const runtime = collectRuntimeClosure();
  for (const dep of runtime) {
    fs.cpSync(
      dep.path,
      path.join(stage, "node_modules", ...dep.name.split("/")),
      {
        recursive: true
      }
    );
  }

  const patches = [];
  for (const dep of runtime) {
    const file = path.join(
      stage,
      "node_modules",
      ...dep.name.split("/"),
      "package.json"
    );
    const before = fs.readFileSync(file);
    const meta = JSON.parse(before);
    if (
      meta.dependencies?.lodash &&
      meta.dependencies.lodash !== pkg.dependencies.lodash
    ) {
      const previous = meta.dependencies.lodash;
      meta.dependencies.lodash = pkg.dependencies.lodash;
      meta.dcmsPackagingNotice =
        `DCMS ${pkg.version} changed only the Lodash dependency declaration to match the qualified bundled override. ` +
        "Upstream implementation source is unchanged.";
      const after = JSON.stringify(meta, null, 2) + "\n";
      fs.writeFileSync(file, after);
      patches.push({
        package: dep.name,
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
  const stagedPackage = structuredClone(pkg);
  stagedPackage.files = [
    ...stagedPackage.files,
    "DCMS_DEPENDENCY_METADATA_PATCHES.json"
  ];
  stagedPackage.bundledDependencies = Object.keys(
    stagedPackage.dependencies ?? {}
  );
  delete stagedPackage.overrides;
  delete stagedPackage.devDependencies;
  delete stagedPackage.scripts;
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify(stagedPackage, null, 2) + "\n"
  );

  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        process.env.npm_execpath,
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        out
      ],
      { cwd: stage, encoding: "utf8" }
    )
  );
  const archive = path.join(out, result[0].filename);
  const report = {
    gate: "workspace engine pack",
    package: `${pkg.name}@${pkg.version}`,
    archive: path.relative(root, archive),
    archiveSha256: createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex"),
    runtimeDependencies: runtime.map(({ name, version }) => ({
      name,
      version
    })),
    dependencyMetadataPatches: patches,
    npmPack: result[0]
  };
  fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "evidence/packed-engine-build.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.rmSync(stageRoot, { recursive: true, force: true });
}
