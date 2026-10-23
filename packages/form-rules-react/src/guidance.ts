/** Format engine-provided acceptable-input guidance for simple UI surfaces. */
export interface GuidanceLike {
  display?: string;
  kind?: string;
  appliesTo?: string;
}
export function guidanceText(
  guidance: GuidanceLike | null | undefined
): string {
  if (!guidance) return "No validation applied";
  return guidance.display || "No validation applied";
}
