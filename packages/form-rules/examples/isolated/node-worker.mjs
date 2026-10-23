/** Worker owns one plan. Only authored definitions and raw values cross the process boundary. */
import { parentPort, workerData } from "node:worker_threads";
import { compileForm, evaluateRecordPayload } from "@dcms/form-rules";
const error = (e) => ({
  code: e?.code ?? "WORKER_FAILED",
  message: e instanceof Error ? e.message : String(e)
});
let plan;
try {
  plan = compileForm(workerData.definition);
  parentPort.postMessage({ id: 0, result: { planKey: plan.key } });
} catch (e) {
  parentPort.postMessage({ id: 0, error: error(e) });
}
parentPort.on("message", ({ id, payload }) => {
  try {
    parentPort.postMessage({
      id,
      result: evaluateRecordPayload(plan, payload)
    });
  } catch (e) {
    parentPort.postMessage({ id, error: error(e) });
  }
});
