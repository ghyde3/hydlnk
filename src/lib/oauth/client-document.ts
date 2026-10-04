import { HYDLNK_NAME_REFUSAL, namesHydlnk, sanitizeClientName } from "./client-name";
import { VENDOR_NAME_REFUSAL, namesVendorWithoutRight } from "./known-clients";
import { validateRedirectUriList } from "./redirect-uri";

/**
 * What a Client ID Metadata Document must say, and how long it is trusted (M10-08). The document is
 * data: only `client_name`, `client_uri`, `logo_uri` and `redirect_uris` are read, copied into fresh
 * values (a `__proto__` or `constructor` key does nothing), and nothing else is ever stored. No URL
 * in it is rendered as a link or requested by the browser; only `logo_uri` is fetched at all, by the
 * server, under M10-09. `token_endpoint_auth_method` is a declaration only: the client is always a
 * public client, no secret or assertion is asked for or checked, and `jwks_uri` is never fetched.
 */

export const CIMD_MIN_CACHE_SECONDS = 300;
export const CIMD_MAX_CACHE_SECONDS = 86_400;
export const CIMD_DEFAULT_CACHE_SECONDS = 3_600;

export type DocumentRefusal =
  | "not_an_object"
  | "client_id_mismatch"
  | "bad_name"
  | "bad_redirect_uris"
  | "bad_auth_method"
  | "has_secret"
  | "bad_grant_types"
  | "bad_response_types"
  | "name_impersonates";

export type ValidatedDocument =
  | {
      ok: true;
      /** The cleaned name; the client's host when nothing readable is left. */
      name: string;
      redirectUris: string[];
      /** The declared logo address, only a string; the logo path decides whether it is used. */
      logoUri: string | null;
    }
  | { ok: false; reason: DocumentRefusal; description?: string };

const has = (object: object, name: string): boolean => Object.hasOwn(object, name);
const read = (object: object, name: string): unknown =>
  has(object, name) ? (object as Record<string, unknown>)[name] : undefined;

/**
 * Is `json` a valid document for the address it was fetched from? `url` is the `client_id`; `host` is
 * its host (the name a document without a usable one falls back to).
 */
export function validateClientDocument(
  json: unknown,
  url: string,
  host: string,
  options: { rootDomain?: string } = {},
): ValidatedDocument {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, reason: "not_an_object" };
  }
  // The identifier equals the address it was fetched from, by simple string comparison.
  if (read(json, "client_id") !== url) return { ok: false, reason: "client_id_mismatch" };

  const rawName = read(json, "client_name");
  if (typeof rawName !== "string" || rawName.trim() === "")
    return { ok: false, reason: "bad_name" };

  const redirects = validateRedirectUriList(
    read(json, "redirect_uris"),
    options.rootDomain ? { rootDomain: options.rootDomain } : {},
  );
  if (!redirects.ok) return { ok: false, reason: "bad_redirect_uris" };

  const method = read(json, "token_endpoint_auth_method");
  if (method !== undefined && method !== "none" && method !== "private_key_jwt") {
    return { ok: false, reason: "bad_auth_method" };
  }
  if (has(json, "client_secret") || has(json, "client_secret_expires_at")) {
    return { ok: false, reason: "has_secret" };
  }

  // Other grant types are ignored, not an error (Claude's own document lists the jwt-bearer grant).
  const grants = read(json, "grant_types");
  if (grants !== undefined && !(Array.isArray(grants) && grants.includes("authorization_code"))) {
    return { ok: false, reason: "bad_grant_types" };
  }
  const responses = read(json, "response_types");
  if (responses !== undefined && !(Array.isArray(responses) && responses.includes("code"))) {
    return { ok: false, reason: "bad_response_types" };
  }

  const name = sanitizeClientName(rawName, host);
  if (namesHydlnk(name)) {
    return { ok: false, reason: "name_impersonates", description: HYDLNK_NAME_REFUSAL };
  }
  // 'Claude' or 'ChatGPT' only for a client that returns to that company (or to this computer).
  if (namesVendorWithoutRight(name, redirects.uris)) {
    return { ok: false, reason: "name_impersonates", description: VENDOR_NAME_REFUSAL };
  }

  const logo = read(json, "logo_uri");
  return {
    ok: true,
    name,
    redirectUris: redirects.uris,
    logoUri: typeof logo === "string" && logo !== "" ? logo : null,
  };
}

/**
 * How long a fetched document is trusted: the response's `Cache-Control: max-age` clamped to 300 to
 * 86,400 seconds, 3,600 when there is no header, and the 300-second floor for `no-store`, `no-cache`,
 * `private` and `max-age=0` (a floor, so repeated authorize requests do not each cause a fetch).
 */
export function cacheLifetimeSeconds(cacheControl: string | null | undefined): number {
  if (!cacheControl) return CIMD_DEFAULT_CACHE_SECONDS;
  const directives = cacheControl
    .toLowerCase()
    .split(",")
    .map((part) => part.trim());
  if (directives.some((d) => d === "no-store" || d === "no-cache" || d === "private")) {
    return CIMD_MIN_CACHE_SECONDS;
  }
  const maxAge = directives.find((d) => /^max-age\s*=/.test(d));
  if (maxAge === undefined) return CIMD_DEFAULT_CACHE_SECONDS;
  const seconds = Number(maxAge.split("=")[1]?.trim().replace(/^"|"$/g, ""));
  if (!Number.isFinite(seconds) || seconds <= 0) return CIMD_MIN_CACHE_SECONDS;
  return Math.min(CIMD_MAX_CACHE_SECONDS, Math.max(CIMD_MIN_CACHE_SECONDS, Math.floor(seconds)));
}
