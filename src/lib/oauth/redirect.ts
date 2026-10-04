import { REDIRECT_ERRORS, type RedirectErrorCode } from "./messages";

/**
 * The only way an answer reaches an app's redirect address (M10-11, M10-14). The address has already
 * passed `redirectUriMatches`, so it is a URI the app itself declared; the parameters are appended
 * to it, never the other way round, and each is percent-encoded exactly once with
 * `encodeURIComponent`, so a `state` holding `%0d%0a`, spaces, `&`, `#`, `=` or non-ASCII text cannot
 * add a header, a parameter or a fragment. The address's own query is kept byte for byte.
 *
 * Every authorization response, success and error alike, carries `iss` (RFC 9207), the issuer string
 * of the metadata, so a client can tell which server answered.
 */

export type RedirectParam = readonly [name: string, value: string | undefined];

export function buildClientRedirect(redirectUri: string, params: readonly RedirectParam[]): string {
  const pairs = params
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  const location = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}${pairs.join("&")}`;
  // The result must parse as one URL with no fragment and no user information of its own.
  const parsed = new URL(location);
  if (parsed.hash !== "" || parsed.username !== "" || parsed.password !== "") {
    throw new Error("a redirect location carried a fragment or user information");
  }
  return location;
}

export function successParams(code: string, state: string | null, issuer: string): RedirectParam[] {
  return [
    ["code", code],
    ["state", state ?? undefined],
    ["iss", issuer],
  ];
}

export function errorParams(
  error: RedirectErrorCode,
  state: string | null,
  issuer: string,
  descriptionOverride?: string,
): RedirectParam[] {
  return [
    ["error", error],
    ["error_description", descriptionOverride ?? REDIRECT_ERRORS[error]],
    ["state", state ?? undefined],
    ["iss", issuer],
  ];
}

/** The 303 to an app, with the headers that keep the code out of a Referer and out of a cache. */
export function clientRedirectResponse(
  location: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...extraHeaders,
    },
  });
}
