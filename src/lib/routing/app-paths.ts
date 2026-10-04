/**
 * The second set of app-host paths that never touch a session cookie, after `/share/{token}` (M6-10).
 * They are the connector's bearer-credential and discovery paths: the MCP endpoint, three OAuth
 * endpoints and the two discovery documents. The proxy handles them BEFORE `rewriteWithSession`: it
 * neither reads nor refreshes the session for them, deletes the `Cookie` request header before the
 * rewrite (the route can never see a session, as a custom host's cannot), sets no cookie, and answers
 * with its own headers. One exact list, each on it for a reason:
 *
 *   /mcp                                     the MCP endpoint: a bearer token, never a cookie (M10-04)
 *   /oauth/token                             code and refresh token exchange: PKCE and the code (M10-15)
 *   /oauth/register                          Dynamic Client Registration, open and rate limited (M10-10)
 *   /oauth/revoke                            RFC 7009 revocation: the token itself is the credential (M10-17)
 *   /.well-known/oauth-authorization-server  RFC 8414 metadata, public and cacheable (M10-03)
 *   /.well-known/oauth-protected-resource    RFC 9728 metadata, public and cacheable (M10-03)
 *   /.well-known/oauth-protected-resource/mcp  the path-insertion form of the same document (M10-03)
 *
 * `/oauth/authorize` (the consent page) and `/oauth/consent` (its form post) are NOT here: they need
 * the person's session and stay on the ordinary `rewriteWithSession` path, with the app host's headers.
 *
 * Exact matches only: `/mcp/`, `/mcp/x`, `/oauth/tokenx`, `/.well-known/` and the OpenID configuration
 * path are the app's ordinary answer (a 404). None of these paths ends in a static-file extension, so the
 * proxy matcher (src/proxy.ts) still sees all of them (tests/unit/m10-routing-app-paths.test.ts).
 */

export type BearerPathKind = "metadata" | "endpoint";

const BEARER_PATHS: Readonly<Record<string, BearerPathKind>> = {
  "/mcp": "endpoint",
  "/oauth/token": "endpoint",
  "/oauth/register": "endpoint",
  "/oauth/revoke": "endpoint",
  "/.well-known/oauth-authorization-server": "metadata",
  "/.well-known/oauth-protected-resource": "metadata",
  "/.well-known/oauth-protected-resource/mcp": "metadata",
};

/** `endpoint` or `metadata` for one of the seven paths, `null` for every other path. */
export function classifyAppPath(pathname: string): BearerPathKind | null {
  return Object.hasOwn(BEARER_PATHS, pathname) ? BEARER_PATHS[pathname]! : null;
}

/** The seven public paths, for the tests and the docs. */
export const BEARER_PATH_LIST: readonly string[] = Object.keys(BEARER_PATHS);
