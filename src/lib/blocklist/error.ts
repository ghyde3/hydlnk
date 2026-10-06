/**
 * Reading the database's refusal of a draft that links to a blocked site (M5-03). Safe in client
 * and server code: no imports.
 *
 * The `pages` trigger raises SQLSTATE HL005 with the message `blocked_link`, the offending hosts
 * (comma separated, as the browser would resolve them) in DETAIL and the ids of the blocks that
 * hold them (comma separated) in HINT. PostgREST answers HTTP 400 with `{code, message, details,
 * hint}`; supabase-js hands the same four fields back on `error`.
 */

/** SQLSTATE of the refusal (the next code in the HL series from the init migration). */
export const BLOCKED_LINK_CODE = "HL005";
/** The exception message of the refusal. */
export const BLOCKED_LINK_MESSAGE = "blocked_link";

export interface BlockedLinkError {
  /** The distinct hosts the draft links to that are blocked, lower case. */
  hosts: string[];
  /** The ids of the blocks holding them (empty when the database did not say). */
  blockIds: string[];
}

interface ErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const split = (value: string | null | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

/**
 * The refusal behind a failed draft save, or null when the error is something else. The error is
 * permanent: retrying the same draft is refused again, so the autosave must not retry it.
 */
export function readBlockedLinkError(error: ErrorLike | null | undefined): BlockedLinkError | null {
  if (!error) return null;
  if (error.code !== BLOCKED_LINK_CODE && error.message !== BLOCKED_LINK_MESSAGE) return null;
  return { hosts: split(error.details), blockIds: split(error.hint) };
}

/**
 * Does the URL typed in a field point at one of the hosts the database refused? Used to decide which
 * field shows the inline error. Compares the host a browser would resolve: lower case, no trailing
 * dot, no port, no credentials. A value that is not a URL never matches.
 */
export function urlPointsAtHost(value: string, hosts: readonly string[]): boolean {
  if (hosts.length === 0) return false;
  let hostname: string;
  try {
    hostname = new URL(value.trim()).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return false;
  }
  return hosts.includes(hostname);
}
