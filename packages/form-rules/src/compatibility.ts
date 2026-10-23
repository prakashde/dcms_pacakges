/**
 * Deterministic compatibility and source identities.
 *
 * Why this exists: a cached compiled plan must never be reused for a different Form definition or incompatible engine
 * build. These hashes are cache/compatibility identities, not security signatures; release integrity uses SHA-256.
 */
import type { FormDefinition } from "./types.js";

/** Stable FNV-1a 64-bit content hash for compatibility/cache identity. Not a security hash. */
export function compatibilityHash64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Canonical JSON used only to create deterministic compatibility/cache identities. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value)
        ? JSON.stringify(value)
        : `{"$dcmsNonFiniteNumber":${JSON.stringify(String(value))}}`;
    case "undefined":
      return "null";
    case "object": {
      if (Array.isArray(value))
        return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
      const object = value as Record<string, unknown>;
      const keys = Object.keys(object)
        .filter((key) => object[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
    }
    default:
      return JSON.stringify(String(value));
  }
}

/** Stable hash of the complete authored Form definition, independent of object-property order. */
export function formDefinitionSourceHash(definition: FormDefinition): string {
  return compatibilityHash64(canonicalJson(definition));
}
