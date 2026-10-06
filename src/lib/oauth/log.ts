/**
 * The one place the authorization server writes a log line (M10-17). A line holds an event name and
 * fields that are never a secret: a code (such as `code_reuse`), a client id or a host, a count. No
 * token, code, verifier, form secret, header, cookie or address ever goes through here, and nothing
 * else in src/lib/oauth, src/lib/mcp or the OAuth routes calls `console` (a scan keeps it that way,
 * tests/unit/m10-oauth-secrets.test.ts).
 */
export function logOauthEvent(event: string, fields: Record<string, string | number> = {}): void {
  const parts = Object.entries(fields).map(([name, value]) => `${name}=${String(value)}`);
  console.warn(`[oauth] ${event}${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`);
}

/** An error from the store or the limiter, reduced to its operation and code: never a value. */
export function logOauthFailure(operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : "unknown error";
  // The store's messages hold the operation and the PostgREST code only; keep the first line.
  console.error(`[oauth] ${operation} failed: ${message.split("\n", 1)[0]}`);
}
