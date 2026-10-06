/**
 * The constants of the OAuth authorization server (Wave L, M10-03 to M10-19). No imports and no
 * secrets: the metadata, the consent screen, the endpoints and the tests read the same numbers.
 */

/** The three scopes, in the order the consent screen lists them. `hydlnk.read` is always granted. */
export const OAUTH_SCOPES = ["hydlnk.read", "hydlnk.write", "hydlnk.publish"] as const;
export type OauthScope = (typeof OAUTH_SCOPES)[number];

export const SCOPE_READ = "hydlnk.read" as const;
export const SCOPE_WRITE = "hydlnk.write" as const;
export const SCOPE_PUBLISH = "hydlnk.publish" as const;

export function isOauthScope(value: string): value is OauthScope {
  return (OAUTH_SCOPES as readonly string[]).includes(value);
}

/** The known scopes among `scopes`, in the canonical order, without repeats (read is NOT added). */
export function orderedScopes(scopes: Iterable<string>): OauthScope[] {
  const wanted = new Set(scopes);
  return OAUTH_SCOPES.filter((scope) => wanted.has(scope));
}

/** A scope list in the canonical order, without repeats, always holding read. */
export function canonicalScopes(scopes: Iterable<string>): OauthScope[] {
  const wanted = new Set(scopes);
  wanted.add(SCOPE_READ);
  return OAUTH_SCOPES.filter((scope) => wanted.has(scope));
}

/** The path of the MCP endpoint on the app host. */
export const MCP_PATH = "/mcp";

/** RFC 9728 path-insertion form of the protected resource metadata for the resource at `/mcp`. */
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";
export const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";

/** Token lifetimes (M10-15, M10-16). */
export const ACCESS_TOKEN_SECONDS = 3600;
/** The authorization code lives a minute and is used once. */
export const OAUTH_CODE_SECONDS = 60;
/** A refresh token lives 60 days from the moment it was issued, so a used connection keeps rolling. */
export const REFRESH_IDLE_SECONDS = 60 * 24 * 60 * 60;
/** No chain of refresh tokens lives longer than a year from the grant's last authorization. */
export const REFRESH_FAMILY_MAX_SECONDS = 365 * 24 * 60 * 60;
/** A pending authorize request lives ten minutes. */
export const OAUTH_REQUEST_SECONDS = 10 * 60;

/** The most active connected apps one person can hold (the database enforces it, HL007). */
export const MAX_ACTIVE_GRANTS = 20;

/**
 * Prefixes of the three secret shapes. They exist so a leaked token is recognizable by secret
 * scanners; the whole string, prefix included, is what is hashed.
 */
export const TOKEN_PREFIX = {
  access: "hl_at_",
  refresh: "hl_rt_",
  code: "hl_ac_",
} as const;

/** 256 random bits as 43 base64url characters. */
export const TOKEN_BODY_LENGTH = 43;

/** The longest `Authorization` bearer value looked at (refused before hashing beyond this). */
export const MAX_BEARER_LENGTH = 256;

/** Cookie that carries the pending request across the sign-in (M10-12). */
export const OAUTH_RESUME_COOKIE = "hl_oauth_resume";
export const OAUTH_RESUME_COOKIE_SECONDS = 600;

/** Registered clients that nobody used: the oldest are deleted past this many (M10-10). */
export const UNUSED_DCR_CAP = 20_000;

/** The one place the last-used time of a token is written, at most this often (M10-04). */
export const LAST_USED_WRITE_SECONDS = 60;
