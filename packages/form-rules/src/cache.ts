/**
 * Small dependency-free LRU cache used by server/browser integration examples.
 *
 * Why this exists: compiled plans are safe to reuse only under their full compatibility/source identity. The cache
 * remains generic and deliberately simple so eviction policy cannot alter rule semantics.
 */
/**
 * Capacity-limited least-recently-used storage with no TTL or synchronization.
 * Use defined values: undefined is indistinguishable from a cache miss and does not refresh recency.
 * Compiled-plan callers must use the complete compatibility/source cache key.
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  /** Reject zero, negative, fractional or non-finite capacity. */
  constructor(private readonly maxEntries = 100) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new RangeError("Cache capacity must be a positive safe integer.");
  }
  /** Read a defined value and make it the most recently used entry. */
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  /** Insert or refresh an entry, evicting the oldest entries above capacity. */
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries)
      this.map.delete(this.map.keys().next().value as K);
  }
  /** Remove every cached entry. */
  clear(): void {
    this.map.clear();
  }
  /** Current entry count, including any stored undefined values. */
  get size(): number {
    return this.map.size;
  }
}
