import { isRequestId, constantTimeEqual, generateToken, sha256Hex } from "./tokens";
import { OAUTH_SCOPES, SCOPE_READ, canonicalScopes, isOauthScope } from "./constants";
import { logOauthFailure } from "./log";
import type { MessageKind, SignedInUser } from "./authorize";
import { classifyRequest } from "./authorize";
import { matchesAnyRedirectUri } from "./redirect-uri";
import { buildClientRedirect, errorParams, successParams } from "./redirect";
import { GrantLimitError, type OauthStore } from "./store";
import type { LimitFn } from "./register";

/**
 * The person's answer (M10-13, M10-14): `POST /oauth/consent`. The decision is a plain form post, so
 * it works with JavaScript off and answers a real 303. Everything a forged post could change is
 * ignored or checked:
 *
 *   - `Origin` must be the app origin exactly; a post with no Origin (or the literal `null`, which is
 *     what a browser sends for a form post under `Referrer-Policy: no-referrer`) and a `Sec-Fetch-Site`
 *     other than `same-origin` is refused (CSRF, first wall);
 *   - the signed-in user must own the pending request, and the per-render form secret must match its
 *     stored hash (second wall: bound to the request and the person, accepted once);
 *   - the form carries only the request id, the secret, the decision and the scope ticks. The client,
 *     the redirect address, the state, the challenge and the resource are read from the pending row,
 *     whatever else a forged form adds; a scope the app never asked for is dropped and read is always
 *     granted;
 *   - the stored redirect address is checked again against the client's CURRENT row;
 *   - the row moves pending -> issued/denied in one locked conditional update (the database function
 *     `oauth_decide_request`), so two simultaneous Allow posts issue exactly one code.
 *
 * The code exists in memory for as long as it takes to build the `Location`: it is never rendered,
 * never logged and never stored in clear (only its SHA-256).
 */

export const CONSENT_PER_USER_PER_HOUR = 30;
export const CONSENT_MAX_BODY_BYTES = 4 * 1024;

export type ConsentResult =
  | { kind: "redirect"; location: string }
  | { kind: "login" }
  | { kind: "message"; status: number; message: MessageKind; clearResume: boolean };

export interface ConsentDeps {
  store: Pick<
    OauthStore,
    "getRequest" | "getClient" | "decideRequest" | "isSuspended" | "getActiveGrant"
  >;
  limit: LimitFn;
  now: () => number;
  /** `https://app.hydlnk.com`: the one origin a decision may come from. */
  appOrigin: string;
  issuer: string;
  /** Test seam: the canary code generator. */
  newCode?: () => string;
}

export interface ConsentInput {
  origin: string | null;
  secFetchSite: string | null;
  user: SignedInUser | null;
  /** The posted fields: single values for `request`, `csrf`, `decision`; `scope` may repeat. */
  fields: URLSearchParams;
}

const message = (status: number, kind: MessageKind, clearResume = false): ConsentResult => ({
  kind: "message",
  status,
  message: kind,
  clearResume,
});

/**
 * The post must come from this app's own page. Its `Origin` must be the app origin exactly. A request
 * with no `Origin`, or with the literal `null`, is accepted only when the browser says it is a
 * same-origin request (`Sec-Fetch-Site: same-origin`; same-site and cross-site are refused, so a page
 * on a tenant host or an attacker's sandboxed frame never gets in).
 *
 * `null` has to be allowed for one reason: the consent screen sends `Referrer-Policy: no-referrer`
 * (its answer carries a one-time code to another site), and a browser serializes the `Origin` of a form
 * post as `null` under that policy even when the post goes to the page's own origin.
 */
export function isSameOriginPost(
  origin: string | null,
  secFetchSite: string | null,
  appOrigin: string,
): boolean {
  if (origin !== null && origin !== "null") return origin === appOrigin;
  return secFetchSite === "same-origin";
}

export async function decideConsent(
  input: ConsentInput,
  deps: ConsentDeps,
): Promise<ConsentResult> {
  // First wall: where the post came from.
  if (!isSameOriginPost(input.origin, input.secFetchSite, deps.appOrigin)) {
    return message(403, "forbidden");
  }
  if (!input.user) return { kind: "login" };

  try {
    return await decide(input, input.user, deps);
  } catch (error) {
    logOauthFailure("consent", error);
    return message(500, "forbidden");
  }
}

async function decide(
  input: ConsentInput,
  user: SignedInUser,
  deps: ConsentDeps,
): Promise<ConsentResult> {
  const fields = input.fields;
  for (const name of ["request", "csrf", "decision"]) {
    if (fields.getAll(name).length > 1) return message(403, "forbidden");
  }
  const requestId = fields.get("request");
  const csrf = fields.get("csrf");
  const decision = fields.get("decision");
  if (!isRequestId(requestId) || !csrf || (decision !== "allow" && decision !== "deny")) {
    return message(403, "forbidden");
  }

  const verdict = await deps.limit(`oauth-consent:${user.id}`, CONSENT_PER_USER_PER_HOUR, 3600);
  if (!verdict.allowed) return message(429, "rate_limited");

  // Whose request is it, and is it still open?
  const row = await deps.store.getRequest(requestId);
  if (!row) return message(403, "forbidden");
  if (row.user_id !== user.id) {
    return row.user_id === null ? message(403, "forbidden") : message(403, "someone_else");
  }
  if (row.status !== "pending") return message(400, "answered", true);
  if (Date.parse(row.request_expires_at) <= deps.now()) return message(400, "expired", true);

  // Second wall: the form secret of the page that was last drawn, once.
  const stored = row.csrf_hash;
  if (!stored || !constantTimeEqual(sha256Hex(csrf), stored)) return message(403, "forbidden");

  // The app's own row, as it is now: a redirect address that is no longer declared is refused.
  const client = await deps.store.getClient(row.client_id);
  if (!client || !matchesAnyRedirectUri(client.redirect_uris, row.redirect_uri)) {
    return message(403, "app_changed");
  }

  // Blocked by an admin since the screen was drawn (M13-10): nothing is issued, not even a denial
  // redirect to an address the app chose.
  if (client.blocked_at !== null) return message(403, "app_blocked", true);

  const denyOutcome = (): ConsentResult => ({
    kind: "redirect",
    location: buildClientRedirect(
      row.redirect_uri,
      errorParams("access_denied", row.state, deps.issuer),
    ),
  });

  // A suspended account cannot connect an app: an Allow is treated as a Deny (the function checks too).
  const effective =
    decision === "allow" && (await deps.store.isSuspended(user.id)) ? "deny" : decision;

  const code = effective === "allow" ? (deps.newCode ?? (() => generateToken("code")))() : null;
  // Only the ticks of scopes the app asked for count; read is always in.
  const ticked = fields
    .getAll("scope")
    .filter(isOauthScope)
    .filter((scope) => row.scopes_requested.includes(scope));
  const scopes = canonicalScopes([SCOPE_READ, ...ticked]).filter((scope) =>
    OAUTH_SCOPES.includes(scope),
  );

  let changed;
  try {
    changed = await deps.store.decideRequest({
      id: row.id,
      userId: user.id,
      csrfHash: stored,
      decision: effective,
      scopes,
      codeHash: code === null ? null : sha256Hex(code),
    });
  } catch (error) {
    if (error instanceof GrantLimitError) return message(409, "grant_limit");
    throw error;
  }

  if (!changed) {
    // Lost a race (another answer, an expiry): say what is true now.
    const now = await deps.store.getRequest(requestId);
    const classified = classifyRequest(now, user.id, deps.now());
    return classified.kind === "message"
      ? {
          kind: "message",
          status: classified.status,
          message: classified.message,
          clearResume: true,
        }
      : message(400, "expired", true);
  }

  if (changed.status === "issued" && code !== null) {
    return {
      kind: "redirect",
      location: buildClientRedirect(
        changed.redirect_uri,
        successParams(code, changed.state, deps.issuer),
      ),
    };
  }
  return denyOutcome();
}
