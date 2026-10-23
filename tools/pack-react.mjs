/**
 * Pack @dcms/form-rules-react into artifacts/ from the npm workspace.
 * The package is ESM-only and ships its compiled dist/ output.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "artifacts");
fs.mkdirSync(out, { recursive: true });

const result = JSON.parse(
  execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "pack",
      "--workspace=@dcms/form-rules-react",
      "--pack-destination",
      out,
      "--json"
    ],
    { cwd: root, encoding: "utf8" }
  )
);

console.log(JSON.stringify(result, null, 2));
