/**
 * Convert reference/prototype rich text into the plain text consumed by rules.
 *
 * This is not a production Lexical serializer. DCMS must define one canonical
 * rich-text-to-validation-text representation and use it consistently in the
 * browser and on the authoritative server.
 */
export function richTextToValidationText(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  const root = document.createElement("div");
  root.innerHTML = html;
  return (root.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
