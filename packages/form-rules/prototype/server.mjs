/** Minimal local prototype host. This exists only to serve the reference UI, not as a production DCMS service. */
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  extname,
  join,
  normalize,
  dirname,
  relative,
  isAbsolute
} from "node:path";
import { fileURLToPath } from "node:url";
import { compileForm, evaluateRecordPayload } from "../dist/esm/index.js";
import { buildPrototypeDefinition } from "./form-definition.mjs";

const port = Number(process.env.PORT || 32190);
const here = dirname(fileURLToPath(import.meta.url));
const root = normalize(join(here, ".."));
const runtimeDir = join(here, "runtime");
const { definition } = buildPrototypeDefinition();
const plan = compileForm(definition); // authoritative server plan compiled once at startup
await mkdir(runtimeDir, { recursive: true });

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};
async function body(req) {
  let s = "",
    bytes = 0;
  for await (const c of req) {
    bytes += c.length;
    if (bytes > 2 * 1024 * 1024)
      throw Object.assign(new Error("Payload too large"), { status: 413 });
    s += c;
  }
  return s ? JSON.parse(s) : {};
}
function summary(r) {
  return {
    canSave: r.canSave,
    canSubmit: r.canSubmit,
    blockingCount: r.blockingFieldIds.length,
    warningCount: r.warningFieldIds.length,
    invalidCount: r.invalidFieldIds.length,
    blockingFieldIds: r.blockingFieldIds,
    warningFieldIds: r.warningFieldIds
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const activePort = server.address().port,
      host = `127.0.0.1:${activePort}`;
    if (
      req.headers.host !== host &&
      req.headers.host !== `localhost:${activePort}`
    ) {
      res.writeHead(403);
      return res.end("Invalid Host");
    }
    if (
      req.headers.origin &&
      ![`http://${host}`, `http://localhost:${activePort}`].includes(
        req.headers.origin
      )
    ) {
      res.writeHead(403);
      return res.end("Invalid Origin");
    }
    if (
      req.method === "POST" &&
      (req.url === "/api/save" || req.url === "/api/submit")
    ) {
      const payload = await body(req);
      const result = evaluateRecordPayload(plan, {
        formId: plan.formId,
        formVersion: plan.version,
        values: payload.values
      });
      if (req.url === "/api/save") {
        await writeFile(
          join(runtimeDir, "saved-draft.json"),
          JSON.stringify(
            {
              savedAt: new Date().toISOString(),
              values: payload.values,
              validation: summary(result)
            },
            null,
            2
          )
        );
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ saved: true, ...summary(result) }));
      }
      if (!result.canSubmit) {
        res.writeHead(422, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ submitted: false, ...summary(result) })
        );
      }
      await writeFile(
        join(runtimeDir, "submitted-record.json"),
        JSON.stringify(
          {
            submittedAt: new Date().toISOString(),
            values: payload.values,
            validation: summary(result)
          },
          null,
          2
        )
      );
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ submitted: true, ...summary(result) }));
    }
    let url = req.url === "/" ? "/prototype/index.html" : req.url.split("?")[0];
    if (url.endsWith("/")) url += "index.html";
    url = decodeURIComponent(url);
    if (
      url.includes("..") ||
      url.includes("\\") ||
      !["/prototype/", "/dist/", "/node_modules/"].some((p) =>
        url.startsWith(p)
      ) ||
      url.startsWith("/prototype/runtime/") ||
      url.endsWith("server.mjs")
    ) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const file = normalize(join(root, url));
    const local = relative(root, file);
    if (local.startsWith("..") || isAbsolute(local)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const data = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch (e) {
    res.writeHead(
      e.status ??
        (e.code === "PAYLOAD_INVALID" || e instanceof SyntaxError ? 400 : 500),
      { "content-type": "application/json" }
    );
    res.end(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `DCMS prototype: http://127.0.0.1:${server.address().port}/prototype/`
  )
);
