/** React subscriptions for the headless Workbench store. */
import { useCallback, useSyncExternalStore } from "react";
import type { WorkbenchStore } from "./workbench-store.js";

/** Subscribe a React component to the complete Workbench snapshot. */
export function useWorkbenchSnapshot(store: WorkbenchStore) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}

/** Subscribe only to one Form node so unrelated edits do not force rerenders. */
export function useWorkbenchNode(store: WorkbenchStore, nodeId: string) {
  const subscribe = useCallback(
    (changed: () => void) => store.subscribeNode(nodeId, changed),
    [store, nodeId]
  );
  const read = useCallback(() => store.getNode(nodeId), [store, nodeId]);
  return useSyncExternalStore(subscribe, read, read);
}
