/**
 * The one HTML escaper of the live document's head (M8-02): every title and every attribute value
 * the builder writes goes through it. Escapes the five characters that can end a text node or an
 * attribute value, so a tenant string (a name, a bio, a share title) is only ever text.
 */
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]!);
}
