import {
  ACCESS_TOKEN_SECONDS,
  MAX_BEARER_LENGTH,
  TOKEN_BODY_LENGTH,
  TOKEN_PREFIX,
} from "./constants";
import { logOauthEvent, logOauthFailure } from "./log";
import { sameRedirectUri } from "./redirect-uri";
import { resourceMatches } from "./resource";
import { isSubset, parseScopeParam, scopeString } from "./scopes";
import { generateToken, pkceMatches, sha256Hex } from "./tokens";
import { parseForm, type BodyRead } from "./http";
import type { HttpResult, LimitFn } from "./register";
import type { OauthStore, RequestRow, TokenLookup } from "./store";

/**
 * The token endpoint (M10-15, M10-16): the authorization code grant with PKCE and the refresh token
 * grant with rotation. A pure core over an injected store, limiter and clock; the route reads the
 * request, caps the body and hands the pieces in.
 *
 * What it decides, in the order it decides it:
 *
 *   1. per-address limit, form content type, a body of at most 16 KB, each parameter at most once;
 *   2. client authentication is NONE: a `client_secret` is `invalid_client`, a Basic header is accepted
 *      only when it names exactly this `client_id` with an empty password, `client_assertion` is
 *      ignored (the client is authenticated by the code and the PKCE verifier alone);
 *   3. an unknown client is `invalid_client`. There is NO per-client limit: a client address is shared
 *      by everyone who connects that app (Claude's is one URL for every person), so a bucket keyed on
 *      it would be one budget for all of them and a lever for one caller to starve the rest (Wave L
 *      review). The address limit above is the only brake before the code or the token is checked;
 *   4. the grant itself. Every failure of the code checks is the same `invalid_grant` with a fixed
 *      description, so nothing says which part was wrong.
 *
 * It never fetches a URL, never reads a client's document, and never logs a code, a verifier or a
 * token: the only log line names an event and a client id.
 */

export const TOKEN_MAX_BODY_BYTES = 16 * 1024;
/**
 * Per caller address. Claude's and ChatGPT's servers call this endpoint for many people from a few
 * addresses, so the budget is high; a wrong code or refresh token is still refused on every request.
 */
export const TOKEN_PER_IP_PER_MINUTE = 600;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export interface TokenDeps {
  store: Pick<
    OauthStore,
    | "getClient"
    | "getRequestByCodeHash"
    | "redeemCode"
    | "getTokenByHash"
    | "rotateRefresh"
    | "endFamily"
    | "getActiveGrant"
  >;
  limit: LimitFn;
  /** Milliseconds since the epoch. */
  now?: () => number;
  /** The canonical MCP URL: the only `resource` a token can be for. */
  resource: string;
  /** Test seam: token generators (production uses the CSPRNG). */
  newAccessToken?: () => string;
  newRefreshToken?: () => string;
}

export interface TokenInput {
  clientKey: string;
  mediaType: string;
  /** The raw `Authorization` header, or null. */
  authorization: string | null;
  readBody: () => Promise<BodyRead>;
}

function oauthError(
  status: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
): HttpResult {
  return {
    status,
    body: { error, error_description: description },
    headers: { ...NO_STORE, ...headers },
  };
}

const invalidRequest = (description: string) => oauthError(400, "invalid_request", description);
const invalidGrant = () =>
  oauthError(400, "invalid_grant", "The code or the refresh token isn’t valid.");
const invalidClient = () => oauthError(400, "invalid_client", "The app isn’t recognized.");
const invalidTarget = () =>
  oauthError(400, "invalid_target", "That resource isn’t one this server issues tokens for.");

/** `application/x-www-form-urlencoded` of one value, as a client library writes it into Basic auth. */
function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

/**
 * A Basic header is accepted only when its whole decoded text is `client_id:` (the password is empty),
 * with the id raw or form encoded. The text is compared whole, never split at a colon: a client id is
 * an https address and holds colons of its own.
 */
export function basicNamesClient(header: string, clientId: string): boolean {
  const match = /^basic +([A-Za-z0-9+/=_-]+)$/i.exec(header.trim());
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  } catch {
    return false;
  }
  return decoded === `${clientId}:` || decoded === `${formEncode(clientId)}:`;
}

const CODE_PATTERN = new RegExp(`^${TOKEN_PREFIX.code}[A-Za-z0-9_-]{${TOKEN_BODY_LENGTH}}$`);
const REFRESH_PATTERN = new RegExp(`^${TOKEN_PREFIX.refresh}[A-Za-z0-9_-]{${TOKEN_BODY_LENGTH}}$`);

export async function handleTokenRequest(input: TokenInput, deps: TokenDeps): Promise<HttpResult> {
  const now = deps.now ?? Date.now;

  // 1. the address limit, the content type, the body, the form.
  const perAddress = await deps.limit(
    `oauth-token:${input.clientKey}`,
    TOKEN_PER_IP_PER_MINUTE,
    60,
  );
  if (!perAddress.allowed) return limited(perAddress.retryAfter);

  if (input.mediaType !== "application/x-www-form-urlencoded") {
    return oauthError(
      415,
      "invalid_request",
      "Send the request as application/x-www-form-urlencoded.",
    );
  }
  const body = await input.readBody();
  if (!body.ok) {
    return body.reason === "too_large"
      ? oauthError(413, "invalid_request", "That request is too large.")
      : invalidRequest("The request couldn’t be read.");
  }
  const form = parseForm(body.text);
  if (!form.ok) {
    return invalidRequest(
      form.reason === "repeated"
        ? "A parameter was sent more than once."
        : "The request couldn’t be read.",
    );
  }
  const params = form.values;

  // 2. client authentication: none.
  const clientId = params.get("client_id");
  if (params.has("client_secret")) {
    return invalidClient();
  }
  if (input.authorization !== null && /^basic\b/i.test(input.authorization.trim())) {
    if (clientId === undefined || !basicNamesClient(input.authorization, clientId)) {
      return oauthError(401, "invalid_client", "The app isn’t recognized.", {
        "WWW-Authenticate": 'Basic realm="HYDLNK"',
      });
    }
  }
  if (clientId === undefined) return invalidRequest("client_id is required.");

  // 3. the client (no limit keyed on the client id: see the head of this file).
  const grantType = params.get("grant_type");
  if (grantType === undefined) return invalidRequest("grant_type is required.");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return oauthError(400, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  }

  try {
    const client = await deps.store.getClient(clientId);
    if (!client) return invalidClient();

    const resource = params.get("resource");
    if (resource !== undefined && !resourceMatches(resource, deps.resource)) return invalidTarget();

    return grantType === "authorization_code"
      ? await exchangeCode(clientId, params, deps, now)
      : await refreshTokens(clientId, params, deps, now);
  } catch (error) {
    logOauthFailure("token", error);
    return oauthError(500, "server_error", "We couldn’t finish that request. Try again.");
  }
}

function limited(retryAfter: number): HttpResult {
  return oauthError(429, "temporarily_unavailable", "Too many requests. Try again in a minute.", {
    "Retry-After": String(Math.max(1, retryAfter)),
  });
}

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  scopes: readonly string[],
): HttpResult {
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_SECONDS,
      refresh_token: refreshToken,
      scope: scopeString(scopes),
    },
    headers: { ...NO_STORE },
  };
}

/**
 * A copied code or refresh token: the family it belongs to (one install: the tokens of one code
 * exchange and its rotations) ends, and the log names the event and the app. Other installs of the
 * same app keep working (RFC 9700); the grant ends only when no live family is left.
 */
async function endFamily(
  deps: TokenDeps,
  event: string,
  clientId: string,
  familyId: string | null,
): Promise<void> {
  logOauthEvent(event, { client: clientId });
  if (familyId) await deps.store.endFamily(familyId);
}

async function exchangeCode(
  clientId: string,
  params: Map<string, string>,
  deps: TokenDeps,
  now: () => number,
): Promise<HttpResult> {
  const code = params.get("code");
  const redirectUri = params.get("redirect_uri");
  const verifier = params.get("code_verifier");
  if (code === undefined || redirectUri === undefined || verifier === undefined) {
    return invalidRequest("code, redirect_uri and code_verifier are required.");
  }
  if (code.length > MAX_BEARER_LENGTH || !CODE_PATTERN.test(code)) return invalidGrant();

  const row: RequestRow | null = await deps.store.getRequestByCodeHash(sha256Hex(code));
  if (!row || !row.user_id) return invalidGrant();

  // A code that was used before comes back: someone copied it. The install it started ends, but only
  // when the presenter holds the PKCE verifier too (M10-40): the same app, and the verifier that
  // matches the stored challenge. Anyone else who has merely seen the code is refused and ends nothing.
  if (row.status === "used") {
    if (row.client_id !== clientId) return invalidGrant();
    if (!pkceMatches(verifier, row.code_challenge)) return invalidGrant();
    await endFamily(deps, "code_reuse", row.client_id, await codeFamily(deps, row));
    return invalidGrant();
  }
  if (row.status !== "issued" || !row.code_expires_at) return invalidGrant();
  if (Date.parse(row.code_expires_at) <= now()) return invalidGrant();
  if (row.client_id !== clientId) return invalidGrant();
  if (!sameRedirectUri(row.redirect_uri, redirectUri)) return invalidGrant();
  if (!pkceMatches(verifier, row.code_challenge)) return invalidGrant();

  const accessToken = (deps.newAccessToken ?? (() => generateToken("access")))();
  const refreshToken = (deps.newRefreshToken ?? (() => generateToken("refresh")))();
  const result = await deps.store.redeemCode({
    codeHash: sha256Hex(code),
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
  });

  if (result.outcome === "ok" && result.scopes) {
    return tokenResponse(accessToken, refreshToken, result.scopes);
  }
  if (result.outcome === "not_redeemable") {
    // Used between the read and the write (two exchanges at once) is a copy; expired is just late.
    const again = await deps.store.getRequestByCodeHash(sha256Hex(code));
    if (
      again?.status === "used" &&
      again.user_id &&
      again.client_id === clientId &&
      pkceMatches(verifier, again.code_challenge)
    ) {
      await endFamily(deps, "code_reuse", again.client_id, await codeFamily(deps, again));
    }
  }
  return invalidGrant();
}

/**
 * The family a used code started. A code redeemed before families existed has none recorded: its
 * tokens were given the grant's id as their family, so that is its family.
 */
async function codeFamily(deps: TokenDeps, row: RequestRow): Promise<string | null> {
  if (row.family_id) return row.family_id;
  if (!row.user_id) return null;
  const grant = await deps.store.getActiveGrant(row.user_id, row.client_id);
  return grant?.id ?? null;
}

async function refreshTokens(
  clientId: string,
  params: Map<string, string>,
  deps: TokenDeps,
  now: () => number,
): Promise<HttpResult> {
  const presented = params.get("refresh_token");
  if (presented === undefined) return invalidRequest("refresh_token is required.");
  if (presented.length > MAX_BEARER_LENGTH || !REFRESH_PATTERN.test(presented))
    return invalidGrant();

  const scopeParam = parseScopeParam(params.get("scope"));
  if (!scopeParam.ok)
    return oauthError(400, "invalid_scope", "That scope isn’t one this server knows.");

  const found: TokenLookup | null = await deps.store.getTokenByHash(sha256Hex(presented));
  if (!found || found.kind !== "refresh") return invalidGrant();

  // Another app's refresh token, or one that was already exchanged: it was copied. There is no grace
  // window (M10-40): the presented client id is public, so "the same app" proves nothing, and a false
  // positive now ends one install only.
  if (found.clientId !== clientId || found.rotatedAt !== null) {
    await endFamily(deps, "refresh_reuse", found.clientId, found.familyId);
    return invalidGrant();
  }
  if (found.revokedAt !== null || found.grantRevokedAt !== null) return invalidGrant();
  if (Date.parse(found.expiresAt) <= now()) return invalidGrant();

  // A scope may only narrow what the grant holds today. The new pair is never wider than the presented
  // token either (the store intersects with its scopes), so a narrowed chain stays narrow.
  const requested = scopeParam.scopes;
  if (requested.length > 0 && !isSubset(requested, found.grantScopes)) {
    return oauthError(400, "invalid_scope", "That scope is wider than the app was allowed.");
  }

  const accessToken = (deps.newAccessToken ?? (() => generateToken("access")))();
  const refreshToken = (deps.newRefreshToken ?? (() => generateToken("refresh")))();
  const result = await deps.store.rotateRefresh({
    oldId: found.id,
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
    scopes: requested.length > 0 ? requested : null,
  });

  switch (result.outcome) {
    case "ok":
      return tokenResponse(accessToken, refreshToken, result.scopes ?? []);
    case "invalid_scope":
      return oauthError(400, "invalid_scope", "That scope is wider than the app was allowed.");
    case "lost": {
      // Exchanged by the time the write ran is a copy; expired or revoked in the meantime is just late.
      const again = await deps.store.getTokenByHash(sha256Hex(presented));
      if (again?.rotatedAt) {
        await endFamily(deps, "refresh_reuse", found.clientId, found.familyId);
      }
      return invalidGrant();
    }
    default:
      return invalidGrant();
  }
}
