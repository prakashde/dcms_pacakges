import { useSyncExternalStore } from "react";
import type {
  AsyncHostActionController,
  AsyncHostActionSnapshot
} from "./async-action.js";

export interface AsyncHostActionStatusProps<TResult> {
  snapshot: AsyncHostActionSnapshot<TResult>;
  idleLabel?: string;
  pendingLabel?: string;
  successLabel?: string;
  errorPrefix?: string;
}

/** Subscribe React to a host-action controller without transferring controller ownership. */
export function useAsyncHostAction<TInput, TResult>(
  controller: AsyncHostActionController<TInput, TResult>
) {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
}

/**
 * Accessible, transport-neutral status presentation for Draft Save / Submit actions.
 * The host still owns the actual persistence request, retry policy and acknowledgement data.
 */
export function AsyncHostActionStatus<TResult>({
  snapshot,
  idleLabel = "Ready",
  pendingLabel = "Saving…",
  successLabel = "Saved",
  errorPrefix = "Save failed"
}: AsyncHostActionStatusProps<TResult>) {
  let message = idleLabel;
  if (snapshot.state === "pending") message = pendingLabel;
  else if (snapshot.state === "success") message = successLabel;
  else if (snapshot.state === "error") {
    message = snapshot.error
      ? `${errorPrefix}: ${snapshot.error}`
      : errorPrefix;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      data-async-action-state={snapshot.state}
    >
      {message}
    </span>
  );
}
