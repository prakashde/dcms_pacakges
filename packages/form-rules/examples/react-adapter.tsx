/** A real React subscriber; only fields notified by the store need to render again. */
import { useCallback, useSyncExternalStore } from "react";
import type { FormStore } from "./form-store.js";
export function NumberField({
  store,
  id,
  label
}: {
  store: FormStore;
  id: string;
  label: string;
}) {
  const subscribe = useCallback(
    (changed: () => void) => store.subscribeField(id, changed),
    [store, id]
  );
  const read = useCallback(() => store.getField(id), [store, id]);
  const result = useSyncExternalStore(subscribe, read, read);
  if (!result) return null;
  const status =
    result.evaluationState === "error" ? "error" : result.validationState;
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="text"
        inputMode="decimal"
        value={String(result.enteredValue ?? "")}
        onChange={(event) => store.change(id, event.target.value)}
      />
      <span role="status">{status}</span>
      <small>{result.inputGuidance.display}</small>
    </label>
  );
}
// Construct the store once for the current Record. Call replaceDefinition whenever the complete
// authored content changes, even if formId/version were accidentally reused. For SSR, initialize
// browser and server stores with the same serialized definition/values before hydration.
// Small plans give immediate feedback. For expensive/untrusted plans, use browser-worker-client.mjs;
// never display a previous passing status as current while asynchronous evaluation is pending.
