import { OAUTH_SCOPES, isOauthScope, orderedScopes, type OauthScope } from "./constants";

/**
 * The `scope` parameter of the authorize and token requests (M10-11, M10-16): space separated words,
 * each one of the three supported scopes. `offline_access` is accepted and dropped (the authorization
 * server always issues a refresh token, and never stores or shows that word). Any other word is
 * `invalid_scope`.
 */
export type ScopeParse = { ok: true; scopes: OauthScope[] } | { ok: false };

export function parseScopeParam(value: string | null | undefined): ScopeParse {
  if (value === undefined || value === null) return { ok: true, scopes: [] };
  const words = value.split(" ").filter((word) => word !== "");
  const wanted: string[] = [];
  for (const word of words) {
    if (word === "offline_access") continue;
    if (!isOauthScope(word)) return { ok: false };
    wanted.push(word);
  }
  return { ok: true, scopes: orderedScopes(wanted) };
}

/** What an authorize request without a usable `scope` asks for: everything. */
export function allScopes(): OauthScope[] {
  return [...OAUTH_SCOPES];
}

/** `hydlnk.read hydlnk.write`: the form of the `scope` member of a token response. */
export function scopeString(scopes: readonly string[]): string {
  return orderedScopes(scopes).join(" ");
}

/** Is `subset` inside `whole`? */
export function isSubset(subset: readonly string[], whole: readonly string[]): boolean {
  return subset.every((scope) => whole.includes(scope));
}
