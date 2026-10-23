/** Requirements: pending is never approval, debounce really delays, and failed generations stay invalid. */
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserRuleController } from "../examples/browser-worker-client.mjs";
const definition = () => ({ formId: "worker-audit", version: 1, fields: [] });
const payload = (x) => ({
  formId: "worker-audit",
  formVersion: 1,
  values: { x }
});
function harness(t, options = {}, d = definition()) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const workers = [];
  const create = () => {
    const worker = {
      sent: [],
      terminated: 0,
      postMessage(m) {
        this.sent.push(structuredClone(m));
      },
      terminate() {
        this.terminated++;
      }
    };
    workers.push(worker);
    return worker;
  };
  const c = createBrowserRuleController(create, d, {
    debounceMs: 120,
    deadlineMs: 500,
    ...options
  });
  t.after(() => c.dispose());
  const ready = (w = workers.at(-1)) =>
    w.onmessage({ data: { type: "ready", generation: w.sent[0].generation } });
  const requests = (w = workers.at(-1)) =>
    w.sent.filter((m) => m.type === "evaluate");
  const reply = (request, result, w = workers.at(-1)) =>
    w.onmessage({ data: { ...request, evaluation: { canSubmit: result } } });
  return { c, workers, ready, requests, reply };
}
test("W01 real debounce interval coalesces edits and sends only the latest values", (t) => {
  const h = harness(t);
  h.ready();
  const value = payload(1);
  h.c.setPayload(value);
  value.values.x = 999;
  assert.equal(h.c.getState().canSubmit, false);
  t.mock.timers.tick(119);
  assert.equal(h.requests().length, 0);
  h.c.setPayload(payload(2));
  t.mock.timers.tick(119);
  assert.equal(h.requests().length, 0);
  t.mock.timers.tick(1);
  assert.equal(h.requests().length, 1);
  assert.deepEqual(h.requests()[0].payload, payload(2));
});
test("W11 repeated flush cannot postpone an in-flight deadline", async (t) => {
  const h = harness(t);
  h.ready();
  h.c.setPayload(payload(1));
  const first = h.c.flush(),
    a = assert.rejects(first, { code: "WORKER_DEADLINE" });
  t.mock.timers.tick(499);
  const second = h.c.flush(),
    b = assert.rejects(second, { code: "WORKER_DEADLINE" });
  assert.equal(h.requests().length, 1);
  t.mock.timers.tick(1);
  await Promise.all([a, b]);
  assert.equal(h.c.getState().status, "error");
});
test("W12 a payload is snapshotted before delayed dispatch", (t) => {
  const h = harness(t);
  h.ready();
  const input = payload(7);
  h.c.setPayload(input);
  input.values.x = 999;
  t.mock.timers.tick(120);
  assert.deepEqual(h.requests()[0].payload, payload(7));
});
test("W13 initialization and active worker errors reject waiters and disable Submit", async (t) => {
  const h = harness(t);
  h.c.setPayload(payload(1));
  const initial = h.c.flush(),
    a = assert.rejects(initial, { code: "DEFINITION_INVALID" });
  const w = h.workers[0];
  w.onmessage({
    data: {
      type: "initialization-error",
      generation: w.sent[0].generation,
      error: { code: "DEFINITION_INVALID", message: "Bad definition" }
    }
  });
  await a;
  assert.equal(h.c.getState().canSubmit, false);
  h.c.setPayload(payload(2));
  h.ready();
  const current = h.c.flush(),
    b = assert.rejects(current, { code: "WORKER_FAILED" });
  h.workers[1].onerror();
  await b;
  assert.equal(h.c.getState().status, "error");
});
test("W02 worker startup does not bypass an outstanding debounce interval", (t) => {
  const h = harness(t);
  h.c.setPayload(payload(1));
  t.mock.timers.tick(30);
  h.ready();
  assert.equal(h.requests().length, 0);
  t.mock.timers.tick(89);
  assert.equal(h.requests().length, 0);
  t.mock.timers.tick(1);
  assert.equal(h.requests().length, 1);
});
test("W03 flush bypasses debounce but concurrent flushes share one in-flight request", async (t) => {
  const h = harness(t);
  h.ready();
  h.c.setPayload(payload(1));
  const a = h.c.flush(),
    b = h.c.flush();
  a.catch(() => {});
  b.catch(() => {});
  assert.equal(h.requests().length, 1);
  h.reply(h.requests()[0], true);
  assert.deepEqual(await a, { canSubmit: true });
  assert.deepEqual(await b, { canSubmit: true });
  t.mock.timers.tick(1000);
  assert.equal(h.requests().length, 1);
  assert.equal(h.c.getState().status, "ready");
});
test("W04 an edit rejects old flush waiters and stale replies cannot restore Submit", async (t) => {
  const h = harness(t);
  h.ready();
  h.c.setPayload(payload(1));
  const old = h.c.flush();
  const rejected = assert.rejects(old, { code: "EVALUATION_SUPERSEDED" });
  const request = h.requests()[0];
  h.c.setPayload(payload(2));
  await rejected;
  h.reply(request, true);
  assert.equal(h.c.getState().status, "pending");
  assert.equal(h.c.getState().canSubmit, false);
  const next = h.c.flush();
  h.reply(h.requests().at(-1), false);
  assert.deepEqual(await next, { canSubmit: false });
});
test("W05 a deadline invalidates every late result from the terminated worker", async (t) => {
  const h = harness(t);
  h.ready();
  h.c.setPayload(payload(1));
  const p = h.c.flush(),
    rejected = assert.rejects(p, { code: "WORKER_DEADLINE" });
  const old = h.workers[0],
    request = h.requests()[0];
  t.mock.timers.tick(500);
  await rejected;
  assert.equal(old.terminated, 1);
  assert.equal(h.c.getState().status, "error");
  h.reply(request, true, old);
  assert.equal(h.c.getState().status, "error");
  assert.equal(h.c.getState().canSubmit, false);
  h.ready(old);
  assert.equal(h.c.getState().status, "error");
});
test("W06 recovery rejects all prior-generation result and error messages", async (t) => {
  const h = harness(t);
  h.ready();
  h.c.setPayload(payload(1));
  const failed = h.c.flush(),
    reject = assert.rejects(failed, { code: "WORKER_DEADLINE" });
  const old = h.workers[0],
    request = h.requests()[0];
  t.mock.timers.tick(500);
  await reject;
  h.c.setPayload(payload(2));
  h.ready();
  const p = h.c.flush();
  old.onerror();
  h.reply(request, true, old);
  assert.equal(h.c.getState().status, "pending");
  h.reply(h.requests().at(-1), false);
  assert.equal((await p).canSubmit, false);
  assert.equal(h.workers.length, 2);
});
test("W07 startup failure rejects waiting flushes and leaves Submit unavailable", async (t) => {
  const h = harness(t);
  h.c.setPayload(payload(1));
  const p = h.c.flush(),
    rejected = assert.rejects(p, { code: "WORKER_STARTUP_DEADLINE" });
  t.mock.timers.tick(5000);
  await rejected;
  assert.equal(h.c.getState().canSubmit, false);
  assert.equal(h.requests().length, 0);
  assert.equal(h.workers[0].terminated, 1);
});
test("W08 disposal rejects waiters and cancels delayed evaluation", async (t) => {
  const h = harness(t);
  h.c.setPayload(payload(1));
  const p = h.c.flush(),
    rejected = assert.rejects(p, /disposed/i);
  h.c.dispose();
  await rejected;
  h.ready();
  t.mock.timers.tick(10000);
  assert.equal(h.requests().length, 0);
  assert.throws(() => h.c.setPayload(payload(2)), /disposed/i);
  await assert.rejects(h.c.flush(), /disposed/i);
});
test("W09 recovery uses the original definition snapshot even if the caller edits its object", async (t) => {
  const d = definition(),
    h = harness(t, {}, d);
  h.ready();
  d.formId = "weaker-definition";
  h.c.setPayload(payload(1));
  const p = h.c.flush(),
    rejected = assert.rejects(p, { code: "WORKER_DEADLINE" });
  t.mock.timers.tick(500);
  await rejected;
  h.c.setPayload(payload(2));
  assert.equal(h.workers[1].sent[0].definition.formId, "worker-audit");
});
test("W10 invalid timer configuration is rejected synchronously", () => {
  for (const options of [
    { debounceMs: -1 },
    { debounceMs: NaN },
    { debounceMs: Infinity },
    { debounceMs: 0.5 },
    { deadlineMs: 0 },
    { deadlineMs: Infinity },
    { deadlineMs: 2 ** 31 }
  ])
    assert.throws(
      () =>
        createBrowserRuleController(
          () => {
            throw new Error("Must validate before creating a worker");
          },
          definition(),
          options
        ),
      RangeError
    );
});
