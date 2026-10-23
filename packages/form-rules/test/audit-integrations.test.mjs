/** Exercise real HTTP/worker boundaries; expected outcomes include absence of unauthorized commits. */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRecordRouter } from "../examples/express-adapter.mjs";
import { createIsolatedSession } from "../examples/isolated/node-session.mjs";
import { compileForm, evaluateRecordPayload } from "../dist/esm/index.js";
const definition = {
  formId: "http-audit",
  version: 7,
  fields: [
    {
      id: "x",
      label: "Raw measurement",
      valueType: "number",
      mustBeCorrect: true,
      validationRows: [
        {
          id: "limit",
          expression: 'VALUE * 2 - FIELD("approvedLimit")',
          criteria: "number_less_than",
          keyword: 0
        }
      ]
    }
  ]
};
const input = (x, action = "submit") => ({
  formId: "http-audit",
  formVersion: 7,
  values: { x },
  action
});
async function server(t, { failure, authorized = true } = {}) {
  const commits = [],
    transactions = [],
    ext = { approvedLimit: 10 };
  const app = express();
  app.use(
    "/records",
    createRecordRouter({
      authorize: (req, res, next) =>
        authorized
          ? ((req.user = { id: "auditor" }), next())
          : res.sendStatus(401),
      withRecordTransaction: async (id, user, fn) => {
        transactions.push({ id, user });
        if (failure === "provider") throw new Error("Database offline");
        return fn({
          definition,
          externalReferences: ext,
          commit: async (value) => {
            if (failure === "commit") throw new Error("Write failed");
            commits.push(structuredClone(value));
          }
        });
      }
    })
  );
  const host = app.listen(0, "127.0.0.1");
  await new Promise((r) => host.once("listening", r));
  t.after(() => new Promise((r) => host.close(r)));
  const post = async (value) => {
    const r = await fetch(
      `http://127.0.0.1:${host.address().port}/records/R42/transition`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value)
      }
    );
    return {
      status: r.status,
      body: r.status === 401 ? await r.text() : await r.json()
    };
  };
  return { post, commits, transactions, ext };
}
test("H01 Express response matches package evaluation and commits raw values under server-owned identity", async (t) => {
  const h = await server(t);
  for (const [x, action, status, count] of [
    [4, "submit", 200, 1],
    [5, "submit", 422, 1],
    [5, "draft", 200, 2]
  ]) {
    const r = await h.post(input(x, action));
    assert.equal(r.status, status);
    assert.equal(h.commits.length, count);
    const expected = evaluateRecordPayload(compileForm(definition), {
      formId: "http-audit",
      formVersion: 7,
      values: { x },
      externalReferences: { approvedLimit: 10 }
    });
    assert.deepEqual(r.body.evaluation, JSON.parse(JSON.stringify(expected)));
    assert.equal(
      r.body.evaluation.fields.x.validationRowResults[0].calculatedValue,
      2 * x - 10
    );
    if (status === 200)
      assert.deepEqual(h.commits.at(-1), {
        action,
        values: { x },
        formId: "http-audit",
        formVersion: 7
      });
  }
  assert.ok(
    h.transactions.every((x) => x.id === "R42" && x.user.id === "auditor")
  );
  h.ext.approvedLimit = 6;
  const changed = await h.post(input(4));
  assert.equal(changed.status, 422);
  assert.equal(h.commits.length, 2);
});
test("H02 unauthorized and malformed requests cannot reach a commit", async (t) => {
  const denied = await server(t, { authorized: false });
  assert.equal((await denied.post(input(1))).status, 401);
  assert.deepEqual(denied.transactions, []);
  assert.deepEqual(denied.commits, []);
  const h = await server(t);
  for (const body of [
    null,
    [],
    {},
    input(1, "approve"),
    { ...input(1), externalReferences: { approvedLimit: 999 } },
    { ...input(1), canSubmit: true }
  ]) {
    assert.equal((await h.post(body)).status, 400);
    assert.equal(h.transactions.length, 0);
  }
  for (const [body, status, code] of [
    [{ ...input(1), formId: "weaker" }, 409, "FORMULA_COMPATIBILITY"],
    [{ ...input(1), formVersion: 8 }, 409, "FORMULA_COMPATIBILITY"],
    [{ ...input(1), values: { x: 1, unexpected: 2 } }, 400, "PAYLOAD_INVALID"]
  ]) {
    const r = await h.post(body);
    assert.equal(r.status, status);
    assert.equal(r.body.code, code);
    assert.equal(h.commits.length, 0);
  }
});
test("H03 transaction provider and commit failures never report a successful save", async (t) => {
  for (const failure of ["provider", "commit"]) {
    const h = await server(t, { failure });
    const r = await h.post(input(1));
    assert.deepEqual(r, {
      status: 500,
      body: { code: "EVALUATION_UNAVAILABLE" }
    });
    assert.equal(h.commits.length, 0);
  }
});
test("H04 persistent worker rejects overlap, recovers from bad payload, and preserves structured evaluation errors", async () => {
  const s = await createIsolatedSession(definition);
  const p = {
    formId: "http-audit",
    formVersion: 7,
    values: { x: 1 },
    externalReferences: { approvedLimit: 10 }
  };
  try {
    const first = s.evaluate(p);
    await assert.rejects(s.evaluate(p), { code: "WORKER_BUSY" });
    assert.equal((await first).canSubmit, true);
    await assert.rejects(s.evaluate({ ...p, values: { x: {} } }), {
      code: "PAYLOAD_INVALID"
    });
    assert.equal((await s.evaluate(p)).canSubmit, true);
    const r = await s.evaluate({ ...p, externalReferences: {} });
    assert.equal(r.canSubmit, false);
    assert.equal(r.fields.x.evaluationState, "error");
    assert.equal(
      r.fields.x.evaluationErrorDetails[0].code,
      "FORMULA_UNRESOLVED_REFERENCE"
    );
  } finally {
    await s.close();
  }
  await assert.rejects(s.evaluate(p), { code: "WORKER_CLOSED" });
});
