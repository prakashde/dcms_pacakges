/** Compile once in a terminable worker. Reject overload instead of accumulating an unlimited queue. */
import { Worker } from "node:worker_threads";
/**
 * Resolve after the worker compiles its private definition, then allow one evaluation at a time.
 * Overlap rejects WORKER_BUSY without a queue. A deadline or worker failure closes the session;
 * create a new session to retry. Always await close() in finally when the request completes.
 * heapMb limits V8 old-generation memory, not the entire process or operating-system allocation.
 */
export async function createIsolatedSession(
  definition,
  { timeoutMs = 1000, startupTimeoutMs = 5000, heapMb = 128 } = {}
) {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isInteger(startupTimeoutMs) ||
    startupTimeoutMs < 1 ||
    !Number.isInteger(heapMb) ||
    heapMb < 32
  )
    throw new RangeError("Invalid worker limits.");
  const worker = new Worker(new URL("./node-worker.mjs", import.meta.url), {
    workerData: { definition },
    resourceLimits: { maxOldGenerationSizeMb: heapMb, stackSizeMb: 8 }
  });
  let pending,
    closed = false,
    sequence = 0;
  const coded = (code, message) => Object.assign(new Error(message), { code });
  const fail = (error) => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    fail(coded("WORKER_CLOSED", "Evaluation session closed."));
    await worker.terminate();
  };
  worker.on("error", (error) => {
    closed = true;
    fail(coded("WORKER_FAILED", error.message));
  });
  worker.on("exit", () => {
    closed = true;
    fail(coded("WORKER_EXITED", "Evaluation worker exited."));
  });
  worker.on("message", (message) => {
    if (!pending || message.id !== pending.id) return;
    const current = pending;
    clearTimeout(current.timer);
    pending = undefined;
    if (message.error)
      current.reject(coded(message.error.code, message.error.message));
    else current.resolve(message.result);
  });
  const waitFor = (id, ms) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fail(
          coded(
            "WORKER_DEADLINE",
            "Evaluation deadline exceeded; result is unavailable and Submit must remain blocked."
          )
        );
        void close();
      }, ms);
      pending = { id, resolve, reject, timer };
    });
  // ID zero is reserved for the initial compilation handshake, before user requests are allowed.
  try {
    await waitFor(0, startupTimeoutMs);
  } catch (error) {
    await close();
    throw error;
  }
  return {
    /** Reject operational failure; a missing result must never be treated as a validation pass. */
    async evaluate(payload) {
      if (closed)
        throw coded(
          "WORKER_CLOSED",
          "Create a new session after a deadline or worker failure."
        );
      if (pending)
        throw coded(
          "WORKER_BUSY",
          "Only one evaluation may be in flight per session."
        );
      const id = ++sequence;
      const result = waitFor(id, timeoutMs);
      try {
        worker.postMessage({ id, payload });
      } catch (error) {
        fail(error);
      }
      return result;
    },
    close
  };
}
