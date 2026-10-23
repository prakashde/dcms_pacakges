/** Internal helpers for stable, runtime-enforced read-only adapter snapshots. */

const MAP_MUTATORS = new Set<PropertyKey>(["set", "delete", "clear"]);
const SET_MUTATORS = new Set<PropertyKey>(["add", "delete", "clear"]);

function mutationError(kind: "Map" | "Set"): never {
  throw new TypeError(`Cannot mutate a read-only DCMS snapshot ${kind}.`);
}

function readonlyMapProxy<K, V>(target: Map<K, V>): Map<K, V> {
  let view: Map<K, V>;
  view = new Proxy(target, {
    get(map, property) {
      if (MAP_MUTATORS.has(property)) return () => mutationError("Map");
      if (property === "forEach") {
        return (
          callback: (value: V, key: K, map: Map<K, V>) => void,
          thisArg?: unknown
        ) =>
          map.forEach((value, key) => callback.call(thisArg, value, key, view));
      }
      const value = Reflect.get(map, property, map) as unknown;
      return typeof value === "function" ? value.bind(map) : value;
    }
  });
  return Object.freeze(view);
}

function readonlySetProxy<T>(target: Set<T>): Set<T> {
  let view: Set<T>;
  view = new Proxy(target, {
    get(set, property) {
      if (SET_MUTATORS.has(property)) return () => mutationError("Set");
      if (property === "forEach") {
        return (
          callback: (value: T, key: T, set: Set<T>) => void,
          thisArg?: unknown
        ) => set.forEach((value) => callback.call(thisArg, value, value, view));
      }
      const value = Reflect.get(set, property, set) as unknown;
      return typeof value === "function" ? value.bind(set) : value;
    }
  });
  return Object.freeze(view);
}

/**
 * Freeze an owned object graph in place. Map/Set containers are replaced by
 * read-only proxies so runtime callers cannot bypass TypeScript Readonly types.
 */
export function freezeOwnedGraph<T>(
  value: T,
  seen = new WeakMap<object, unknown>()
): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  if (Object.isFrozen(objectValue)) return value;
  const existing = seen.get(objectValue);
  if (existing !== undefined) return existing as T;

  if (value instanceof Map) {
    const target = new Map<unknown, unknown>();
    const proxy = readonlyMapProxy(target);
    seen.set(objectValue, proxy);
    for (const [key, entry] of value) {
      target.set(freezeOwnedGraph(key, seen), freezeOwnedGraph(entry, seen));
    }
    return proxy as T;
  }

  if (value instanceof Set) {
    const target = new Set<unknown>();
    const proxy = readonlySetProxy(target);
    seen.set(objectValue, proxy);
    for (const entry of value) target.add(freezeOwnedGraph(entry, seen));
    return proxy as T;
  }

  seen.set(objectValue, value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = freezeOwnedGraph(value[index], seen);
    }
    return Object.freeze(value) as T;
  }

  const record = value as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.writable)
      continue;
    record[key] = freezeOwnedGraph(record[key], seen);
  }
  return Object.freeze(value) as T;
}

/** Clone caller-owned data before freezing it for internal/snapshot ownership. */
export function cloneFrozenGraph<T>(
  value: T,
  seen = new WeakMap<object, unknown>()
): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as object;
  const existing = seen.get(objectValue);
  if (existing !== undefined) return existing as T;

  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>();
    seen.set(objectValue, clone);
    for (const [key, entry] of value) {
      clone.set(cloneFrozenGraph(key, seen), cloneFrozenGraph(entry, seen));
    }
    return freezeOwnedGraph(clone) as T;
  }

  if (value instanceof Set) {
    const clone = new Set<unknown>();
    seen.set(objectValue, clone);
    for (const entry of value) clone.add(cloneFrozenGraph(entry, seen));
    return freezeOwnedGraph(clone) as T;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(objectValue, clone);
    for (const entry of value) clone.push(cloneFrozenGraph(entry, seen));
    return Object.freeze(clone) as T;
  }

  const prototype = Object.getPrototypeOf(value);
  // This helper owns plain DCMS data graphs. Preserve opaque/built-in/custom
  // objects by reference rather than fabricating an object with a prototype
  // whose internal slots/state cannot be cloned generically (for example Date).
  if (prototype !== Object.prototype && prototype !== null) return value;
  const clone = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(objectValue, clone);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ("value" in descriptor) {
      descriptor.value = cloneFrozenGraph(descriptor.value, seen);
    }
    Object.defineProperty(clone, key, descriptor);
  }
  return Object.freeze(clone) as T;
}

/** Build a detached, runtime-enforced read-only Map snapshot. */
export function readonlyMapSnapshot<K, V>(
  source: ReadonlyMap<K, V>,
  cloneValue: (value: V) => V
): ReadonlyMap<K, V> {
  const target = new Map<K, V>();
  for (const [key, value] of source) target.set(key, cloneValue(value));
  return readonlyMapProxy(target);
}
