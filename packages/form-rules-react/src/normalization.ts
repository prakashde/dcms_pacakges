/** Normalize browser numeric input to the engine's finite number/null contract. */
export function normalizeFiniteNumberInput(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  const text = String(raw).trim();
  if (text === "") return null;

  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}
