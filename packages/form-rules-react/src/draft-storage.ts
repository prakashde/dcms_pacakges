/**
 * Minimal browser-storage adapter used by reference/demo flows.
 *
 * Production Draft persistence belongs behind WorkbenchHostServices; this
 * module intentionally contains no synchronization, retry, auth, or conflict
 * policy.
 */
export interface DraftStorage {
  load(key: string): string | null;
  save(key: string, value: string): void;
  remove(key: string): void;
}
/** Wrap a Storage implementation without adding persistence semantics. */
export function createLocalStorageDraftAdapter(storage: Storage): DraftStorage {
  return {
    load: (key) => storage.getItem(key),
    save: (key, value) => storage.setItem(key, value),
    remove: (key) => storage.removeItem(key)
  };
}
export function draftStorageKey(formId: string, version: string | number) {
  return `dcms-workbench:draft:${formId}:${version}`;
}
