import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRecordRouter } from "../examples/express-adapter.mjs";
import { createIsolatedSession } from "../examples/isolated/node-session.mjs";
import { createFormStore } from "../.example-build/form-store.js";
import { createBrowserRuleController } from "../examples/browser-worker-client.mjs";
const definition = {
  formId: "integration",
  version: 1,
  fields: [
    {
      id: "x",
      label: "Measurement",
      valueType: "number",
      mustBeCorrect: true,
      validationRows: [{ id: "r", criteria: "number_greater_than", keyword: 0 }]
    }
  ]
};
const payload = (x) => ({
  formId: "integration",
  formVersion: 1,
  values: { x }
});
test("I01 persistent worker handles sequential evaluations and rejects malformed payloads", async () => {
  const session = await createIsolatedSession(definition);
  try {
    assert.equal((await session.evaluate(payload(1))).canSubmit, true);
    assert.equal((await session.evaluate(payload(-1))).canSubmit, false);
    await assert.rejects(session.evaluate(payload({ bad: 1 })), {
      code: "PAYLOAD_INVALID"
    });
  } finally {
    await session.close();
  }
});
test("I02 expensive third-party function is terminated and cannot retain a passing result", async () => {
  const d = structuredClone(definition);
  d.fields[0].validationRows[0].expression =
    "IF(VALUE=0,1,BESSELJ(1,1000000000))";
  const session = await createIsolatedSession(d, { timeoutMs: 40 });
  try {
    assert.equal((await session.evaluate(payload(0))).canSubmit, true);
    await assert.rejects(session.evaluate(payload(1)), {
      code: "WORKER_DEADLINE"
    });
    await assert.rejects(session.evaluate(payload(0)), {
      code: "WORKER_CLOSED"
    });
  } finally {
    await session.close();
  }
});
test("I03 HTTP route enforces authorization, identity, body limits and authoritative Submit", async () => {
  const commits = [];
  const app = express();
  app.use(
    "/records",
    createRecordRouter({
      authorize: (req, res, next) =>
        req.headers.authorization === "Bearer local-test"
          ? ((req.user = { id: "u" }), next())
          : res.sendStatus(401),
      withRecordTransaction: async (id, user, fn) =>
        fn({
          definition,
          externalReferences: undefined,
          commit: async (row) => {
            assert.equal(id, "123");
            assert.equal(user.id, "u");
            commits.push(row);
          }
        })
    })
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/records/123/transition`;
  const post = (body, auth = true) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: "Bearer local-test" } : {})
      },
      body: typeof body === "string" ? body : JSON.stringify(body)
    });
  try {
    assert.equal(
      (await post({ ...payload(1), action: "submit" }, false)).status,
      401
    );
    assert.equal(
      (await post({ ...payload(-1), action: "submit" })).status,
      422
    );
    assert.equal(commits.length, 0);
    assert.equal((await post({ ...payload(-1), action: "draft" })).status, 200);
    assert.equal(commits.length, 1);
    assert.equal(
      (
        await post({
          ...payload(1),
          action: "submit",
          externalReferences: { approval: true }
        })
      ).status,
      400
    );
    assert.equal(
      (await post({ ...payload(1), action: "submit", formVersion: 2 })).status,
      409
    );
    assert.equal(
      (await post({ ...payload({ bad: 1 }), action: "submit" })).status,
      400
    );
    assert.equal((await post("{bad")).status, 400);
    assert.equal(
      (
        await post({
          ...payload("x".repeat(2 * 1024 * 1024)),
          action: "submit"
        })
      ).status,
      413
    );
    assert.equal((await post({ ...payload(1), action: "submit" })).status, 200);
    assert.equal(commits.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("I04 React store resets changed definitions and rejects edits atomically", () => {
  const store = createFormStore(definition, new Map([["x", 1]]));
  let changes = 0;
  const unsub = store.subscribeField("x", () => changes++);
  store.change("x", -1);
  assert.equal(store.getEvaluation().canSubmit, false);
  assert.equal(changes, 1);
  assert.throws(() => store.change("typo", 1));
  assert.deepEqual(store.payload().values, { x: -1 });
  const next = structuredClone(definition);
  next.fields[0].validationRows[0].keyword = -2;
  store.replaceDefinition(next);
  assert.equal(store.getEvaluation().canSubmit, true);
  assert.equal(changes, 2);
  unsub();
});
test("I05 pending state and explicit flush discard out-of-order replies", async () => {
  let fake;
  const created = [];
  const make = () => {
    fake = {
      sent: [],
      postMessage(m) {
        this.sent.push(m);
      },
      terminate() {
        this.terminated = true;
      }
    };
    created.push(fake);
    return fake;
  };
  const controller = createBrowserRuleController(make, definition, {
    debounceMs: 50,
    deadlineMs: 500
  });
  try {
    fake.onmessage({ data: { type: "ready", generation: 1 } });
    controller.setPayload(payload(1));
    assert.equal(controller.getState().canSubmit, false);
    const p = controller.flush();
    const first = fake.sent.at(-1);
    fake.onmessage({ data: { ...first, evaluation: { canSubmit: true } } });
    assert.equal((await p).canSubmit, true);
    controller.setPayload(payload(-1));
    assert.equal(controller.getState().status, "pending");
    fake.onmessage({ data: { ...first, evaluation: { canSubmit: true } } });
    assert.equal(controller.getState().canSubmit, false);
    const newer = controller.flush();
    const second = fake.sent.at(-1);
    fake.onmessage({ data: { ...second, evaluation: { canSubmit: false } } });
    assert.equal((await newer).canSubmit, false);
  } finally {
    controller.dispose();
  }
  assert.equal(fake.terminated, true);
});
