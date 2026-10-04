/**
 * Which events may leave the app at all (M9-10). Sentry covers the app host only: `app.<root>` (the
 * editor, sign-in, its server actions and API routes). An event about the marketing site, a tenant
 * page, the click redirect `/r`, the view beacon `/api/e`, `/media` or the tenant assets `/_t` is
 * dropped, whatever the SDK saw, and so is an event that carries no request address at all (it cannot
 * be told apart from a tenant request, so it is not sent).
 *
 * Pure: no Sentry import, no environment read. Relative imports only.
 */

/** Paths that are never the app's, even on the app host. */
const EXCLUDED_PATH =
  /^\/(?:t\/|sites\/|r\/|media\/|_t\/|api\/e(?:[/?#]|$))/;

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.(?=:|$)/, "");
}

/** True for an address on the app host (`app.<rootDomain>`) whose path is the app's own. */
export function isAppRequestUrl(url: unknown, rootDomain: string | undefined): boolean {
  if (typeof url !== "string" || url === "") return false;
  const root = rootDomain ? normalizeHost(rootDomain) : "";
  if (root === "") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (normalizeHost(parsed.host) !== `app.${root}`) return false;
  return !EXCLUDED_PATH.test(`${parsed.pathname}${parsed.search}`);
}

interface HasRequest {
  request?: { url?: unknown } | undefined;
}

/** True when the event is about the app host: the one rule `beforeSend` and `beforeSendTransaction` apply. */
export function isAppEvent(event: HasRequest, rootDomain: string | undefined): boolean {
  return isAppRequestUrl(event.request?.url, rootDomain);
}
