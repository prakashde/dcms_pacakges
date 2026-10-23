/** Loopback demonstration only. Production must supply real authentication, permissions and persistence. */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRecordRouter } from "../express-adapter.mjs";
import { definition } from "./definition.js";
export function createDemoApp() {
  const app = express(),
    saved = [];
  let queue = Promise.resolve();
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (
      !/^127\.0\.0\.1:\d+$/.test(host ?? "") &&
      !/^localhost:\d+$/.test(host ?? "")
    )
      return res.sendStatus(403);
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return res.sendStatus(403);
    next();
  });
  app.use(
    "/records",
    createRecordRouter({
      // This local fixture has one synthetic principal and one allowed record; it is not production authentication.
      authorize(req, res, next) {
        if (req.params.recordId !== "DEMO") return res.sendStatus(403);
        req.user = { id: "local-demo" };
        next();
      },
      withRecordTransaction(id, user, fn) {
        const task = queue.then(() =>
          fn({
            definition,
            commit: async (row) => {
              saved.push({ ...row, recordId: id, principal: user.id });
            }
          })
        );
        queue = task.catch(() => {});
        return task;
      }
    })
  );
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const [url, name, type] of [
    ["/", "index.html", "html"],
    ["/app.js", "app.js", "js"]
  ])
    app.get(url, (req, res) => res.type(type).sendFile(path.join(here, name)));
  return { app, saved };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { app } = createDemoApp();
  const server = app.listen(
    Number(process.env.PORT ?? 32191),
    "127.0.0.1",
    () =>
      console.log(
        `DCMS React + Express example: http://127.0.0.1:${server.address().port}/`
      )
  );
}
