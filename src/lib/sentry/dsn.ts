/**
 * The Sentry DSN (M9-10), and whether Sentry is on at all. Pure: no Sentry import, no environment
 * read, relative imports only (next.config.ts loads this file through Node, which has no `@/`).
 *
 * Sentry is OFF unless `NEXT_PUBLIC_SENTRY_DSN` holds a usable DSN. A usable DSN is an https URL of
 * the shape `https://<public key>@<host>/<project id>`. One exception, so the Playwright stub can
 * stand in for Sentry: `http` is accepted for a loopback host (localhost, 127.0.0.1, [::1] or a
 * `*.localhost` name), where nothing real can ever listen. Anything else, an `http` address on the
 * internet, a DSN with the legacy secret, a query or a fragment, a value that is not a URL, is
 * ignored: Sentry stays off and one log line says which variable was ignored, never its value.
 */

export const SENTRY_DSN_VARIABLE = "NEXT_PUBLIC_SENTRY_DSN";

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

/** The trimmed DSN when it is usable, else undefined. */
export function parseSentryDsn(raw: string | null | undefined): string | undefined {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    return undefined;
  }
  // The public key travels as the user part; the legacy secret half must not be there, and nothing
  // after the project id.
  if (url.username === "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return undefined;
  }
  if (!/^\/(?:[^/]+\/)*\d+$/.test(url.pathname)) return undefined;
  return value;
}

/**
 * The DSN to start Sentry with, or undefined. A value that is set but unusable is reported through
 * `log` (one line, naming the variable, never the value); an unset or blank one is silent.
 */
export function resolveSentryDsn(
  raw: string | null | undefined,
  log: (line: string) => void,
): string | undefined {
  const dsn = parseSentryDsn(raw);
  if (dsn === undefined && typeof raw === "string" && raw.trim() !== "") {
    log(`[sentry] ${SENTRY_DSN_VARIABLE} is not a usable https DSN: Sentry stays off`);
  }
  return dsn;
}
