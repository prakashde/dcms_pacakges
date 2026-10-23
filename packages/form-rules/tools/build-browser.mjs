/** Bundle current engine browser fixtures without mutating the frozen historical reference UI. */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const workspaceRoot = path.resolve(packageRoot, "../..");
const verificationDirectory = path.join(packageRoot, ".example-build");
const referenceApp = path.join(
  workspaceRoot,
  "baseline/workbench-app.v0.10.5.js"
);
const source = path.join(packageRoot, "reference-ui/source");

fs.mkdirSync(verificationDirectory, { recursive: true });

const bundle = await build({
  absWorkingDir: packageRoot,
  stdin: {
    contents: `import * as rules from './dist/esm/index.js'; globalThis.DCMSFormRules=rules;\n${fs.readFileSync(referenceApp, "utf8")}`,
    resolveDir: packageRoot
  },
  alias: { "dcms:index": path.join(packageRoot, "dist/esm/index.js") },
  bundle: true,
  preserveSymlinks: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "inline"
});

let html = fs.readFileSync(path.join(source, "template.html"), "utf8");
html = html
  .replace("__CSS__", () =>
    fs.readFileSync(path.join(source, "styles.css"), "utf8")
  )
  .replace(/<script>[\s]*__CHEVROTAIN__[\s]*<\/script>/, "")
  .replace(/<script>[\s]*__FORMULAJS__[\s]*<\/script>/, "")
  .replace(/<script type="importmap">__IMPORTMAP__<\/script>/, "")
  .replace(
    '<script type="module">__APPJS__</script>',
    () =>
      `<script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`
  );
fs.writeFileSync(
  path.join(
    verificationDirectory,
    "DCMS_Form_Rules_Current_Engine_Verification_v0.10.5.html"
  ),
  html
);

await build({
  absWorkingDir: packageRoot,
  entryPoints: ["examples/browser-worker-entry.mjs"],
  bundle: true,
  preserveSymlinks: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: true,
  outfile: "examples/browser-worker.js",
  legalComments: "inline"
});
await build({
  absWorkingDir: packageRoot,
  entryPoints: ["examples/react-javascript/main.jsx"],
  bundle: true,
  preserveSymlinks: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: true,
  outfile: "examples/react-javascript/app.js",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "inline"
});
console.log(
  "Built current engine browser verification fixtures without changing the frozen historical reference UI."
);
