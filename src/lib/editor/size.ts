/**
 * Size of a JSON value the way Postgres counts it: `octet_length(draft::text)` on a jsonb column.
 * jsonb text is compact JSON with one extra space after every ":" and "," outside strings, so
 * `JSON.stringify` alone under-counts it. The editor checks this against `LIMITS.draftBytes`
 * before it sends a draft; the database CHECK (`pages_draft_integrity`) holds the same line.
 */
export function jsonbTextBytes(value: unknown): number {
  const compact = JSON.stringify(value);
  if (compact === undefined) return 0;
  let separators = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < compact.length; i++) {
    const code = compact.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (code === 92)
        escaped = true; // backslash
      else if (code === 34) inString = false; // closing quote
    } else if (code === 34) {
      inString = true;
    } else if (code === 44 || code === 58) {
      separators += 1; // "," or ":"
    }
  }
  return new TextEncoder().encode(compact).length + separators;
}
