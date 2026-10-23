/**
 * Write a `<file>.sha256` sidecar for every tarball in artifacts/.
 * The format matches the sidecars committed under DCMS/vendor/.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "artifacts");

const archives = fs
  .readdirSync(out)
  .filter((name) => name.endsWith(".tgz"))
  .sort();

if (archives.length === 0) {
  throw new Error("No tarballs found in artifacts/. Run npm run pack first.");
}

for (const name of archives) {
  const archive = path.join(out, name);
  const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(path.join(out, `${name}.sha256`), `${hash}  ${name}\n`);
  console.log(`${name}  ${hash}`);
}
