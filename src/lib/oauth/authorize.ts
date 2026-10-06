import { allScopes, parseScopeParam } from "./scopes";
import { OAUTH_REQUEST_SECONDS, orderedScopes, type OauthScope } from "./constants";
import type { AuthorizeErrorClass, RedirectErrorCode } from "./messages";
import { KNOWN_CLIENT_IDS, isKnownClientId } from "./known-clients";
import { logOauthFailure } from "./log";
import { matchesAnyRedirectUri, parseRedirectUri, redirectHostLabel } from "./redirect-uri";
import { buildClientRedirect, errorParams } from "./redirect";
import { resourceMatches } from "./resource";
import { CODE_CHALLENGE_PATTERN, generateCsrfValue, randomRequestId, sha256Hex } from "./tokens";
import type { ClientResolution } from "./clients";
import type { LimitFn } from "./register";
import type { ClientRow, OauthStore, RequestRow } from "./store";

/**
 * GET /oauth/authorize (M10-11, M10-12, M10-13). The order is the contract: no error can bounce a
 * person to an address the app chose.
 *
 *   1. the per-address limit (a 429 page);
 *   2. `client_id` and `redirect_uri` are read first, and a missing, repeated or malformed one is the
 *      error page;
 *   3. the client is resolved (a registered one from the table, a metadata one from the cache or
 *      fetched), and failure is the error page;
 *   4. `redirect_uri` must match one of the client's URIs, exactly (M10-06), and a mismatch is the
 *      error page, never a redirect;
 *   5. every other problem is sent to the app as a 303 with `error`, a fixed `error_description`,
 *      `state` and `iss`, but ONLY for a client whose return address can be trusted: one of the three
 *      real client-metadata documents (known-clients.ts), or a metadata client this signed-in person
 *      has connected before. Anyone can create any other client in one unauthenticated call (a
 *      registration, or a document on a host they own), and an error sent to its address needs no
 *      sign-in and no click, which would make this endpoint a redirector that starts on a hydlnk.com
 *      address (RFC 9700 section 4.11.2). For those clients the same problems are the error page;
 *   6. a valid request is stored as one pending row, and the person is sent to sign in (a 303 to
 *      /login with a cookie, M10-12) or shown the consent screen (M10-13).
 *
 * Pure over an injected store, limiter and clock; the route reads the session and the cookie and turns
 * the result into a response. No outcome ever holds a request parameter that did not pass a rule above.
 */

export const AUTHORIZE_PER_IP_PER_MINUTE = 60;
/**
 * A request that is stored before anyone has signed in is a row (up to about 3 KB) written for a
 * stranger, so the address gets a tighter budget for those (Wave L review). Counted per address only:
 * a bucket shared by everyone would let one caller lock every other person out of connecting an app.
 * The rows themselves are deleted after an hour by `purge-oauth-requests`.
 */
export const AUTHORIZE_NEW_PER_IP_PER_MINUTE = 20;
export const AUTHORIZE_MAX_QUERY_BYTES = 8 * 1024;
export const AUTHORIZE_MAX_VALUE_LENGTH = 2048;
export const STATE_MAX_LENGTH = 512;

export interface SignedInUser {
  id: string;
  email: string;
}

export interface ConsentView {
  requestId: string;
  /** The form secret, shown once in a hidden field. Only its hash is stored. */
  csrf: string;
  clientName: string;
  clientKind: "cimd" | "dcr";
  /** One of the three real client documents (known-clients.ts): the only clients not introduced as unverified. */
  clientKnown: boolean;
  /** The host of a metadata client's address; null for a registered client. */
  clientHost: string | null;
  /** The re-encoded logo as `data:image/png;base64,...`, or null (initials are drawn). */
  logoDataUri: string | null;
  /** The host of the return address, or the loopback label. */
  returnLabel: string;
  returnIsLoopback: boolean;
  /** The return host when it differs from the metadata client's own host, else null. */
  differentSite: string | null;
  email: string;
  /** What the app asked for, in order (always holds read). */
  scopes: OauthScope[];
  /** What the person allowed before, when they have connected this app already. */
  previous: OauthScope[] | null;
  suspended: boolean;
}

/** A page that says one sentence and offers no form. */
export type MessageKind =
  | "expired"
  | "answered"
  | "someone_else"
  | "app_changed"
  | "app_blocked"
  | "grant_limit"
  | "rate_limited"
  | "forbidden";

export type AuthorizeResult =
  | { kind: "error_page"; status: 400 | 429; errorClass: AuthorizeErrorClass; retryAfter?: number }
  | { kind: "redirect"; location: string }
  | { kind: "login"; requestId: string }
  | { kind: "consent"; view: ConsentView }
  | { kind: "message"; status: number; message: MessageKind }
  /** Resume mode with a cookie that names nothing usable: the caller clears it. */
  | { kind: "invalid_resume" };

export interface AuthorizeDeps {
  store: Pick<
    OauthStore,
    "insertRequest" | "getRequest" | "bindRequest" | "getActiveGrant" | "isSuspended" | "getClient"
  >;
  limit: LimitFn;
  now: () => number;
  /** `https://app.hydlnk.com`: the issuer string, put in every redirect as `iss`. */
  issuer: string;
  /** The canonical MCP URL. */
  resource: string;
  resolveClient: (clientId: string) => Promise<ClientResolution>;
  /** The end-to-end stub's address counts as a known client (only while the test hooks are on). */
  allowTestStub?: boolean;
  newRequestId?: () => string;
  newCsrf?: () => string;
}

export interface AuthorizeInput {
  /** The raw query string, without the `?`. */
  rawQuery: string;
  clientKey: string;
  user: SignedInUser | null;
  /** The value of the resume cookie, or null. */
  resumeId: string | null;
}

const KNOWN_ONCE = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "prompt",
  "response_mode",
  "request",
  "request_uri",
] as const;

function errorPage(errorClass: AuthorizeErrorClass, retryAfter?: number): AuthorizeResult {
  return errorClass === "too_many"
    ? { kind: "error_page", status: 429, errorClass, retryAfter: Math.max(1, retryAfter ?? 60) }
    : { kind: "error_page", status: 400, errorClass };
}

/** The host of a client-metadata address, as the URL API writes it (punycode for a Unicode name). */
export function clientAddressHost(clientId: string): string | null {
  try {
    return new URL(clientId).host;
  } catch {
    return null;
  }
}

export async function authorizeRequest(
  input: AuthorizeInput,
  deps: AuthorizeDeps,
): Promise<AuthorizeResult> {
  try {
    return await run(input, deps);
  } catch (error) {
    logOauthFailure("authorize", error);
    return errorPage("invalid");
  }
}

async function run(input: AuthorizeInput, deps: AuthorizeDeps): Promise<AuthorizeResult> {
  // 1. the limit.
  const verdict = await deps.limit(
    `oauth-authorize:${input.clientKey}`,
    AUTHORIZE_PER_IP_PER_MINUTE,
    60,
  );
  if (!verdict.allowed) return errorPage("too_many", verdict.retryAfter);

  // No query at all: the person comes back from signing in, and the pending request is in the cookie.
  if (input.rawQuery === "") return resumeConsent(input, deps);

  if (new TextEncoder().encode(input.rawQuery).length > AUTHORIZE_MAX_QUERY_BYTES) {
    return errorPage("invalid");
  }
  const query = new URLSearchParams(input.rawQuery);
  for (const value of query.values()) {
    if (value.length > AUTHORIZE_MAX_VALUE_LENGTH) return errorPage("invalid");
  }
  const once = (name: string): string | null | "repeated" => {
    const all = query.getAll(name);
    if (all.length === 0) return null;
    if (all.length > 1) return "repeated";
    return all[0]!;
  };

  // 2. the two parameters that decide where an answer may go.
  const clientId = once("client_id");
  if (clientId === null || clientId === "repeated" || clientId === "")
    return errorPage("unknown_app");
  const redirectUri = once("redirect_uri");
  if (redirectUri === null || redirectUri === "repeated" || redirectUri === "") {
    return errorPage("bad_redirect");
  }

  // 3. the client.
  const resolved = await deps.resolveClient(clientId);
  if (!resolved.ok) {
    return errorPage(
      resolved.reason === "too_many" ? "too_many" : resolved.reason,
      resolved.retryAfter,
    );
  }
  const client = resolved.client;

  // 3b. an app an admin has blocked (M13-10) is refused before anything else is read from the
  // request, and never redirected: its return address is not trusted, whoever it is.
  if (client.blocked_at !== null) return errorPage("app_blocked");

  // 4. the return address.
  if (
    !parseRedirectUri(redirectUri).ok ||
    !matchesAnyRedirectUri(client.redirect_uris, redirectUri)
  ) {
    return errorPage("bad_redirect");
  }

  // 5. everything else goes back to the app, because its return address can be trusted now.
  const stateValue = once("state");
  const stateUsable =
    typeof stateValue === "string" && stateValue.length <= STATE_MAX_LENGTH ? stateValue : null;
  let mayRedirect: boolean | undefined;
  const trustsReturnAddress = async (): Promise<boolean> => {
    mayRedirect ??= await clientMayReceiveErrors(client, input.user, deps);
    return mayRedirect;
  };
  const fail = async (error: RedirectErrorCode, description?: string): Promise<AuthorizeResult> =>
    (await trustsReturnAddress())
      ? {
          kind: "redirect",
          location: buildClientRedirect(
            redirectUri,
            errorParams(error, stateUsable, deps.issuer, description),
          ),
        }
      : errorPage("invalid");

  if (query.has("request")) return fail("request_not_supported");
  if (query.has("request_uri")) return fail("request_uri_not_supported");
  for (const name of KNOWN_ONCE) {
    if (query.getAll(name).length > 1) return fail("invalid_request");
  }
  if (query.getAll("resource").length > 1) return fail("invalid_target");

  const responseType = once("response_type");
  if (responseType === null) return fail("invalid_request");
  if (responseType !== "code") return fail("unsupported_response_type");

  const responseMode = once("response_mode");
  if (responseMode !== null && responseMode !== "query") return fail("invalid_request");

  if (typeof stateValue === "string" && stateValue.length > STATE_MAX_LENGTH) {
    return fail("invalid_request");
  }

  const scopeParam = parseScopeParam(once("scope") as string | null);
  if (!scopeParam.ok) return fail("invalid_scope");
  const scopes = scopeParam.scopes.length > 0 ? scopeParam.scopes : allScopes();

  const challenge = once("code_challenge");
  const method = once("code_challenge_method");
  if (challenge === null || method !== "S256")
    return fail("invalid_request", "PKCE with S256 is required.");
  if (!CODE_CHALLENGE_PATTERN.test(challenge)) {
    return fail("invalid_request", "The code challenge isn’t valid.");
  }

  const resource = once("resource");
  if (resource !== null && !resourceMatches(resource, deps.resource)) return fail("invalid_target");

  const prompt = once("prompt");
  if (prompt !== null && prompt.split(" ").includes("none")) return fail("consent_required");

  // 6. a valid request: one pending row, then sign in or consent. A row for nobody is limited tighter.
  if (!input.user) {
    const fresh = await deps.limit(
      `oauth-authorize-new:${input.clientKey}`,
      AUTHORIZE_NEW_PER_IP_PER_MINUTE,
      60,
    );
    if (!fresh.allowed) return errorPage("too_many", fresh.retryAfter);
  }
  const requestId = (deps.newRequestId ?? randomRequestId)();
  await deps.store.insertRequest({
    id: requestId,
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scopes_requested: scopes,
    state: stateUsable,
    code_challenge: challenge,
    resource: deps.resource,
  });
  if (!input.user) return { kind: "login", requestId };
  return consentFor(requestId, client, input.user, deps);
}

/**
 * May an error be sent to this client's return address before anyone has answered? Only a client of
 * the kind whose address cannot be chosen by a stranger: a known metadata client, or a metadata
 * client this signed-in person has an active grant for. A registered ("hlc_") client never is.
 */
async function clientMayReceiveErrors(
  client: ClientRow,
  user: SignedInUser | null,
  deps: Pick<AuthorizeDeps, "store" | "allowTestStub">,
): Promise<boolean> {
  if (client.kind !== "cimd") return false;
  if (isKnownClientId(client.client_id, { allowTestStub: deps.allowTestStub === true })) return true;
  if (!user) return false;
  return (await deps.store.getActiveGrant(user.id, client.client_id)) !== null;
}

/**
 * The person is signed in and the request is theirs to answer: bind it (the first signed-in person to
 * render a request owns it), store a fresh form secret hash, and describe the screen.
 */
async function consentFor(
  requestId: string,
  client: ClientRow,
  user: SignedInUser,
  deps: AuthorizeDeps,
): Promise<AuthorizeResult> {
  const csrf = (deps.newCsrf ?? generateCsrfValue)();
  const row = await deps.store.bindRequest(requestId, user.id, sha256Hex(csrf));
  if (!row) return classifyUnbindable(requestId, user, deps);

  const withLogo =
    client.kind === "cimd"
      ? ((await deps.store.getClient(client.client_id, { withLogo: true })) ?? client)
      : client;
  const [previous, suspended] = await Promise.all([
    deps.store.getActiveGrant(user.id, client.client_id),
    deps.store.isSuspended(user.id),
  ]);

  const returnLabel = redirectHostLabel(row.redirect_uri);
  const parsed = parseRedirectUri(row.redirect_uri);
  const loopback = parsed.ok && parsed.loopback;
  const clientHost = client.kind === "cimd" ? clientAddressHost(client.client_id) : null;
  const returnHost = parsed.ok ? parsed.host : null;
  const differentSite =
    client.kind === "cimd" && !loopback && clientHost !== null && returnHost !== null
      ? clientHost.split(":")[0]!.toLowerCase() !== returnHost.toLowerCase()
        ? returnHost
        : null
      : null;

  return {
    kind: "consent",
    view: {
      requestId,
      csrf,
      clientName: client.client_name,
      clientKind: client.kind === "cimd" ? "cimd" : "dcr",
      clientKnown: KNOWN_CLIENT_IDS.includes(client.client_id),
      clientHost,
      logoDataUri: logoDataUri(withLogo.logo_png),
      returnLabel,
      returnIsLoopback: loopback,
      differentSite,
      email: user.email,
      scopes: orderedScopes(row.scopes_requested),
      previous: previous ? orderedScopes(previous.scopes) : null,
      suspended,
    },
  };
}

export function logoDataUri(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Why a request cannot be shown to this person: expired, answered, or someone else's. */
async function classifyUnbindable(
  requestId: string,
  user: SignedInUser,
  deps: Pick<AuthorizeDeps, "store" | "now">,
): Promise<AuthorizeResult> {
  const row = await deps.store.getRequest(requestId);
  return classifyRequest(row, user.id, deps.now());
}

export function classifyRequest(
  row: RequestRow | null,
  userId: string,
  nowMs: number,
): AuthorizeResult {
  if (!row) return { kind: "invalid_resume" };
  if (row.user_id !== null && row.user_id !== userId) {
    return { kind: "message", status: 403, message: "someone_else" };
  }
  if (row.status !== "pending") return { kind: "message", status: 400, message: "answered" };
  if (Date.parse(row.request_expires_at) <= nowMs) {
    return { kind: "message", status: 400, message: "expired" };
  }
  return { kind: "message", status: 400, message: "expired" };
}

/** GET /oauth/authorize with no query: the consent screen of the request in the resume cookie. */
async function resumeConsent(input: AuthorizeInput, deps: AuthorizeDeps): Promise<AuthorizeResult> {
  if (!input.user || input.resumeId === null) return errorPage("invalid");
  const row = await deps.store.getRequest(input.resumeId);
  if (!row) return { kind: "invalid_resume" };
  const classified = classifyRequest(row, input.user.id, deps.now());
  const usable =
    row.status === "pending" &&
    (row.user_id === null || row.user_id === input.user.id) &&
    Date.parse(row.request_expires_at) > deps.now();
  if (!usable) return classified;

  const client = await deps.store.getClient(row.client_id);
  if (!client) return { kind: "invalid_resume" };
  if (client.blocked_at !== null) return errorPage("app_blocked");
  return consentFor(row.id, client, input.user, deps);
}

/** The lifetime of the pending request, as the resume cookie's Max-Age. */
export const PENDING_REQUEST_SECONDS = OAUTH_REQUEST_SECONDS;
