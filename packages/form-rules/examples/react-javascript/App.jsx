/** Plain JavaScript React example. No TypeScript compiler or runtime is needed by its consumer. */
import { FORMULA_COMPILER_VERSION } from "@dcms/form-rules";
import React, {
  memo,
  useCallback,
  useState,
  useSyncExternalStore
} from "react";
import { createFormStore } from "../form-store.js";
import { definition, initialValues } from "./definition.js";
const Field = memo(function Field({ store, field }) {
  const subscribe = useCallback(
    (fn) => store.subscribeField(field.id, fn),
    [store, field.id]
  );
  const snapshot = useCallback(
    () => store.getField(field.id),
    [store, field.id]
  );
  const result = useSyncExternalStore(subscribe, snapshot, snapshot);
  const state =
    result.evaluationState === "error" ? "error" : result.validationState;
  return (
    <label className={"field " + state}>
      <span>{field.label}</span>
      <input
        aria-label={field.label}
        inputMode={field.valueType === "number" ? "decimal" : "text"}
        value={String(result.enteredValue ?? "")}
        onChange={(e) => store.change(field.id, e.target.value)}
      />
      <strong data-status={field.id}>{state}</strong>
      <small>{result.inputGuidance.display}</small>
    </label>
  );
});
function Actions({ store }) {
  const evaluation = useSyncExternalStore(
    store.subscribe,
    store.getEvaluation,
    store.getEvaluation
  );
  const [response, setResponse] = useState(""),
    [busy, setBusy] = useState(false);
  async function transition(action) {
    setBusy(true);
    try {
      const res = await fetch("/records/DEMO/transition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...store.payload(), action })
      });
      const body = await res.json();
      setResponse(
        res.ok
          ? `Server committed ${body.action}.`
          : `Server rejected request: ${body.code}.`
      );
    } catch {
      setResponse("Server unavailable. No successful save is confirmed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p role="status" data-record-status>
        {evaluation.canSubmit ? "Record ready" : "Record blocked"}
        {" · "}
        {evaluation.warningFieldIds.length}
        {" warnings · "}
        {evaluation.errorFieldIds.length} errors
      </p>
      <div className="actions">
        <button disabled={busy} onClick={() => transition("draft")}>
          Save draft
        </button>
        <button
          disabled={busy || !evaluation.canSubmit}
          onClick={() => transition("submit")}
        >
          Submit record
        </button>
      </div>
      <p role="status" data-server-response>
        {response}
      </p>
    </>
  );
}
export default function App() {
  const [store] = useState(() =>
    createFormStore(definition, new Map(Object.entries(initialValues)))
  );
  return (
    <main>
      <p className="eyebrow">DCMS FORM RULES {FORMULA_COMPILER_VERSION}</p>
      <h1>Pressure inspection</h1>
      <p>
        Enter a measurement below the current pressure limit. The note is
        advisory; include CHECKED to clear its warning.
      </p>
      <p className="demo-note">
        Local demonstration with fictional values. The Express server
        reevaluates every save and submission.
      </p>
      {definition.fields.map((field) => (
        <Field key={field.id} store={store} field={field} />
      ))}
      <Actions store={store} />
    </main>
  );
}
