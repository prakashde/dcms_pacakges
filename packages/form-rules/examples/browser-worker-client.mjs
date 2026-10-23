/**
 * Own a compiled worker and cloned input snapshots for debounced browser validation.
 * generation identifies the worker instance; revision identifies edits within that instance.
 * Only a reply matching both may approve Submit. Pending/error states always block Submit.
 * flush() shares an in-flight result; setPayload() rejects older waiters as superseded.
 * Retry after failure by editing or flushing. dispose() terminates work and is idempotent.
 * The application must still recheck permissions and current values on its server.
 */
export function createBrowserRuleController(
  makeWorker,
  definition,
  { debounceMs = 120, deadlineMs = 1500, onState = () => {} } = {}
) {
  const validDelay = (value, minimum) =>
    Number.isInteger(value) && value >= minimum && value <= 2147483647;
  if (!validDelay(debounceMs, 0) || !validDelay(deadlineMs, 1))
    throw new RangeError("Invalid worker timer configuration.");
  const ownedDefinition = structuredClone(definition);
  let worker,
    generation = 0,
    revision = 0,
    ready = false,
    disposed = false,
    debounce,
    deadline,
    payload;
  let state = { status: "idle", canSubmit: false },
    waiters = [],
    dispatchRequested = false,
    inFlightRevision;
  const emit = (next) => {
    state = next;
    onState(next);
  };
  const rejectWaiters = (error) => {
    for (const w of waiters) w.reject(error);
    waiters = [];
  };
  const failure = (code, message) => {
    clearTimeout(deadline);
    clearTimeout(debounce);
    // A queued reply may still invoke the old handler after termination. Invalidate its identity first.
    generation++;
    const failed = worker;
    worker = undefined;
    ready = false;
    inFlightRevision = undefined;
    dispatchRequested = false;
    failed?.terminate();
    const error = Object.assign(new Error(message), { code });
    emit({ status: "error", canSubmit: false, error: { code, message } });
    rejectWaiters(error);
  };
  const send = () => {
    clearTimeout(debounce);
    debounce = undefined;
    dispatchRequested = true;
    if (!ready || !payload || disposed) return;
    // Repeated flushes share this result and do not restart its deadline.
    if (inFlightRevision === revision) return;
    dispatchRequested = false;
    inFlightRevision = revision;
    clearTimeout(deadline);
    worker.postMessage({ type: "evaluate", generation, revision, payload });
    deadline = setTimeout(
      () =>
        failure(
          "WORKER_DEADLINE",
          "Evaluation timed out. Edit or retry to start a fresh worker."
        ),
      deadlineMs
    );
  };
  const start = () => {
    const current = ++generation;
    ready = false;
    const instance = makeWorker();
    worker = instance;
    deadline = setTimeout(
      () => failure("WORKER_STARTUP_DEADLINE", "Rule compilation timed out."),
      5000
    );
    instance.onmessage = ({ data }) => {
      if (
        disposed ||
        current !== generation ||
        instance !== worker ||
        data.generation !== generation
      )
        return;
      if (data.type === "ready") {
        clearTimeout(deadline);
        ready = true;
        // Startup does not grant permission to skip an outstanding debounce period.
        if (dispatchRequested) send();
        return;
      }
      if (data.type === "initialization-error") {
        failure(data.error.code, data.error.message);
        return;
      }
      if (data.revision !== revision) return;
      clearTimeout(deadline);
      inFlightRevision = undefined;
      if (data.error) {
        failure(data.error.code, data.error.message);
        return;
      }
      emit({
        status: "ready",
        canSubmit: data.evaluation.canSubmit,
        evaluation: data.evaluation
      });
      for (const w of waiters) w.resolve(data.evaluation);
      waiters = [];
    };
    instance.onerror = () => {
      if (current === generation && instance === worker && !disposed)
        failure("WORKER_FAILED", "Evaluation worker failed.");
    };
    instance.postMessage({
      type: "initialize",
      generation,
      definition: ownedDefinition
    });
  };
  start();
  return {
    /** Publish pending immediately, before the debounce timer or compilation completes. */
    setPayload(next) {
      if (disposed) throw new Error("Controller is disposed.");
      payload = structuredClone(next);
      revision++;
      dispatchRequested = false;
      rejectWaiters(
        Object.assign(new Error("Values changed during evaluation."), {
          code: "EVALUATION_SUPERSEDED"
        })
      );
      emit({ status: "pending", canSubmit: false });
      clearTimeout(debounce);
      if (!worker) start();
      debounce = setTimeout(send, debounceMs);
    },
    /** Request the latest evaluation now; repeated callers share its unchanged deadline. */
    flush() {
      if (disposed) return Promise.reject(new Error("Controller is disposed."));
      if (!payload) return Promise.reject(new Error("No values supplied."));
      if (state.status === "ready") return Promise.resolve(state.evaluation);
      if (!worker) start();
      const promise = new Promise((resolve, reject) =>
        waiters.push({ resolve, reject })
      );
      send();
      return promise;
    },
    /** Return the current state object; callers must not mutate it. */
    getState: () => state,
    /** Invalidate outstanding reply identities before terminating the worker. */
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      clearTimeout(debounce);
      clearTimeout(deadline);
      worker?.terminate();
      worker = undefined;
      rejectWaiters(new Error("Controller disposed."));
    }
  };
}
