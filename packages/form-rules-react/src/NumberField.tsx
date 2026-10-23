/** A real React subscriber; only fields notified by the store need to render again. */
import { useCallback, useId, useSyncExternalStore } from "react";
import type { FormStore } from "./form-store.js";
import { normalizeFiniteNumberInput } from "./normalization.js";

export interface NumberFieldProps {
  store: FormStore;
  id: string;
  label: string;
}

/**
 * Subscribe one numeric control to the small example Form store.
 *
 * The field normalizes browser text before it enters the rules engine and only
 * rerenders when the store reports this field as affected.
 */
export function NumberField({ store, id, label }: NumberFieldProps) {
  const subscribe = useCallback(
    (changed: () => void) => store.subscribeField(id, changed),
    [store, id]
  );
  const read = useCallback(() => store.getField(id), [store, id]);
  const result = useSyncExternalStore(subscribe, read, read);
  const instanceId = useId().replace(/:/g, "");
  if (!result) return null;

  const status =
    result.evaluationState === "error" ? "error" : result.validationState;
  const inputId = `dcms-number-${instanceId}-${id}`;
  const statusId = `${inputId}-status`;
  const invalid =
    result.evaluationState === "error" || result.validationState === "blocking";

  return (
    <label htmlFor={inputId}>
      {label}
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        aria-describedby={statusId}
        aria-invalid={invalid || undefined}
        value={String(result.enteredValue ?? "")}
        onChange={(event) =>
          store.change(id, normalizeFiniteNumberInput(event.target.value))
        }
      />
      <span id={statusId} role="status" aria-live="polite">
        {status}
      </span>
      <small>{result.inputGuidance.display}</small>
    </label>
  );
}

// Construct the store once for the current Record. Call replaceDefinition whenever the complete
// authored content changes, even if formId/version were accidentally reused. For SSR, initialize
// browser and server stores with the same serialized definition/values before hydration.
// Small plans give immediate feedback. For expensive/untrusted plans, use browser-worker-client.mjs;
// never display a previous passing status as current while asynchronous evaluation is pending.
