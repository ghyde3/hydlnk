import { createHash, randomBytes } from "node:crypto";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { adminClient } from "./auth";
import { appRaw, authCookies, cookieHeader, type RawResponse } from "./http";
import { url } from "../helpers";

/**
 * Helpers of the OAuth authorization server's specs (Wave L, M10-03 to M10-19): real requests to the
 * real endpoints and the real database, the way an app would make them. A registered ("hlc_") client
 * needs no network, so every spec starts from one.
 *
 *   const client = await registerClient(["https://a.example/cb"], "My app");
 *   const pair = pkcePair();
 *   page.goto(authorizeUrl(client.client_id, pair.challenge));
 *   // ... sign in, click Allow: the browser is sent to https://a.example/cb?code=..., which
 *   // captureRedirect() answers itself, so no request ever leaves the machine.
 */

export const APP_ORIGIN = "http://app.localhost:3000";
export const RESOURCE = `${APP_ORIGIN}/mcp`;
export const ISSUER = APP_ORIGIN;
export const CLIENT_REDIRECT = "https://a.example/cb";

/**
 * The heading of the consent screen for a registered ("hlc_") app (Wave L review): it leads with that
 * the app is unverified and with where you go back to. `where` is the return host, or "this computer".
 */
export const dcrHeading = (name: string, where = "a.example", loopback = false): string =>
  `“${name}” (unverified) ${loopback ? "on this computer" : `at ${where}`} wants to connect to your HYDLNK`;

/**
 * A client that errors may go back to before anyone has answered (Wave L review): one of the three
 * real client-metadata documents. Its row is cached with a day to live, so authorize needs no fetch.
 * Only the spec that needs it makes it, and removes it again.
 */
export const KNOWN_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
export const KNOWN_CLIENT_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

export async function knownClient(): Promise<{ client_id: string; redirect_uri: string }> {
  const { error } = await adminClient()
    .from("oauth_clients")
    .upsert(
      {
        client_id: KNOWN_CLIENT_ID,
        kind: "cimd",
        client_name: "Claude",
        redirect_uris: [KNOWN_CLIENT_REDIRECT],
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      { onConflict: "client_id" },
    );
  if (error) throw new Error(`knownClient failed: ${error.message}`);
  return { client_id: KNOWN_CLIENT_ID, redirect_uri: KNOWN_CLIENT_REDIRECT };
}

const octet = () => Math.floor(Math.random() * 254) + 1;
/** A client address of this test's own: the limits count per address. */
export const ownIp = (): string => `10.${octet()}.${octet()}.${octet()}`;

/**
 * Give a browser context an address of its own. Every browser in a run reaches the dev server from
 * the same machine, so without this they would share one per-address authorize budget (60 a minute)
 * and a busy run would see the "Too many requests" page that the limit is meant to show.
 */
export async function ownAddress(context: {
  setExtraHTTPHeaders(h: Record<string, string>): Promise<void>;
}): Promise<void> {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": ownIp() });
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function pkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
  client_name: string;
}

/**
 * A registered ("hlc_") client for a spec, made with the secret key: the same row the registration
 * endpoint writes. Specs that are not about registration use this, so they do not spend the
 * endpoint's limits (20 an hour per address and 300 an hour overall, M10-10), which a whole suite run
 * would otherwise use up. `registerClientViaApi` is the real endpoint.
 */
export async function registerClient(
  redirectUris: string[] = [CLIENT_REDIRECT],
  name = "Test app",
): Promise<RegisteredClient> {
  const clientId = `hlc_${randomBytes(16).toString("hex")}`;
  const { error } = await adminClient()
    .from("oauth_clients")
    .insert({ client_id: clientId, kind: "dcr", client_name: name, redirect_uris: redirectUris });
  if (error) throw new Error(`registerClient failed: ${error.message}`);
  return { client_id: clientId, redirect_uris: redirectUris, client_name: name };
}

/** Registers a public client over the real endpoint (the response is the endpoint's own). */
export async function registerClientViaApi(
  redirectUris: string[] = [CLIENT_REDIRECT],
  name = "Test app",
  ip = ownIp(),
): Promise<RegisteredClient> {
  const res = await appRaw("/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ redirect_uris: redirectUris, client_name: name }),
  });
  if (res.status !== 201) throw new Error(`registration failed: ${res.status} ${res.body}`);
  return JSON.parse(res.body) as RegisteredClient;
}

export interface AuthorizeOptions {
  redirectUri?: string;
  state?: string | null;
  scope?: string | null;
  resource?: string | null;
  extra?: Record<string, string>;
}

/** The query of an authorize request, in the shape Claude sends. */
export function authorizeQuery(
  clientId: string,
  challenge: string,
  options: AuthorizeOptions = {},
): string {
  const params = new URLSearchParams();
  params.set("response_type", "code");
  params.set("client_id", clientId);
  params.set("redirect_uri", options.redirectUri ?? CLIENT_REDIRECT);
  if (options.state !== null)
    params.set("state", options.state ?? `st-${randomBytes(6).toString("hex")}`);
  params.set("code_challenge", challenge);
  params.set("code_challenge_method", "S256");
  if (options.resource !== null) params.set("resource", options.resource ?? RESOURCE);
  if (options.scope !== null)
    params.set("scope", options.scope ?? "hydlnk.read hydlnk.write hydlnk.publish");
  for (const [name, value] of Object.entries(options.extra ?? {})) params.set(name, value);
  return params.toString();
}

export const authorizeUrl = (
  clientId: string,
  challenge: string,
  options?: AuthorizeOptions,
): string => `${APP_ORIGIN}/oauth/authorize?${authorizeQuery(clientId, challenge, options)}`;

/** GET /oauth/authorize without a browser (no cookies unless given). */
export function authorizeRaw(
  clientId: string,
  challenge: string,
  options?: AuthorizeOptions,
  extra: { cookie?: string; ip?: string } = {},
): Promise<RawResponse> {
  return appRaw(`/oauth/authorize?${authorizeQuery(clientId, challenge, options)}`, {
    cookie: extra.cookie,
    headers: { "x-forwarded-for": extra.ip ?? ownIp() },
  });
}

export interface TokenResponse {
  status: number;
  body: Record<string, unknown>;
  headers: RawResponse["headers"];
}

export async function tokenRequest(
  form: Record<string, string | undefined>,
  headers: Record<string, string> = {},
): Promise<TokenResponse> {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form))
    if (value !== undefined) params.set(name, value);
  const res = await appRaw("/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ownIp(),
      ...headers,
    },
    body: params.toString(),
  });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: res.status, body, headers: res.headers };
}

export const exchangeCode = (
  clientId: string,
  code: string,
  verifier: string,
  redirectUri = CLIENT_REDIRECT,
  extra: Record<string, string | undefined> = {},
) =>
  tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    ...extra,
  });

export const refreshTokens = (
  clientId: string,
  refreshToken: string,
  extra: Record<string, string | undefined> = {},
) =>
  tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    ...extra,
  });

export async function revokeRequest(
  token: string,
  clientId: string,
  hint?: string,
): Promise<RawResponse> {
  const params = new URLSearchParams({ token, client_id: clientId });
  if (hint) params.set("token_type_hint", hint);
  return appRaw("/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ownIp() },
    body: params.toString(),
  });
}

/**
 * Keeps the browser from following the answer to the client's redirect address (there is no such
 * site): the request is aborted, and the tests read the redirect from the 303 itself.
 */
const blocked = new WeakSet<object>();

export async function blockClientRedirect(
  target: Page | BrowserContext,
  origin = new URL(CLIENT_REDIRECT).origin,
): Promise<void> {
  if (blocked.has(target)) return;
  blocked.add(target);
  await target.route(`${origin}/**`, (route: Route) => route.abort());
}

/**
 * Clicks a button of the consent form and returns the redirect the server answered with: the real
 * 303 of `/oauth/consent`, its status and its Location parsed back. Nothing is rendered in between.
 */
export async function answer(
  page: Page,
  name: "Allow" | "Deny",
): Promise<{ status: number; location: URL; headers: Record<string, string> }> {
  await blockClientRedirect(page);
  const blockedOrigin = new URL(CLIENT_REDIRECT).origin;
  // The browser follows the 303 to the client, the route aborts it and the page lands on its error
  // page. Wait for that to finish, so the spec's next goto is not interrupted by it.
  const aborted = page
    .waitForEvent("requestfailed", {
      predicate: (request) =>
        request.isNavigationRequest() && request.url().startsWith(blockedOrigin),
      timeout: 5000,
    })
    .catch(() => undefined);
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/oauth/consent"),
    page.getByRole("button", { name }).click(),
  ]);
  const location = response.headers()["location"];
  if (!location) throw new Error(`the answer was ${response.status()} with no Location`);
  const target = new URL(location);
  if (target.origin === blockedOrigin) {
    await aborted;
    await page
      .waitForURL((url) => url.protocol === "chrome-error:", { timeout: 5000 })
      .catch(() => undefined);
  }
  return { status: response.status(), location: target, headers: response.headers() };
}

// ---------------------------------------------------------------------------------------------
// The database, with the secret key
// ---------------------------------------------------------------------------------------------

export async function count(table: string, filter: Record<string, string> = {}): Promise<number> {
  let query = adminClient().from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  const { count: total, error } = await query;
  if (error) throw new Error(`count(${table}) failed: ${error.message}`);
  return total ?? 0;
}

export async function rows<T = Record<string, unknown>>(
  table: string,
  filter: Record<string, string> = {},
  columns = "*",
): Promise<T[]> {
  let query = adminClient().from(table).select(columns);
  for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
  const { data, error } = await query;
  if (error) throw new Error(`rows(${table}) failed: ${error.message}`);
  return (data ?? []) as T[];
}

/** The pending requests and codes of one app: name the app, other specs run beside this one. */
export async function codesCount(clientId: string): Promise<number> {
  return count("oauth_authorization_codes", { client_id: clientId });
}

/**
 * The codes issued so far, for one app when `clientId` is given. Name the app: other specs run beside
 * this one and issue codes of their own, so a count over every app is not stable.
 */
export async function issuedCodesCount(clientId?: string): Promise<number> {
  let query = adminClient()
    .from("oauth_authorization_codes")
    .select("*", { count: "exact", head: true })
    .not("code_hash", "is", null);
  if (clientId) query = query.eq("client_id", clientId);
  const { count: total, error } = await query;
  if (error) throw new Error(error.message);
  return total ?? 0;
}

export async function removeClients(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await adminClient().from("oauth_clients").delete().in("client_id", ids);
}

/** Moves a pending request's expiry into the past with the secret key. */
export async function expireRequest(id: string): Promise<void> {
  const { error } = await adminClient()
    .from("oauth_authorization_codes")
    .update({ request_expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export function cookieValue(setCookies: string[], name: string): string | null {
  for (const header of setCookies) {
    const match = new RegExp(`^${name}=([^;]*)`).exec(header);
    if (match) return match[1] ?? null;
  }
  return null;
}

export { url };

// ---------------------------------------------------------------------------------------------
// A real connection, made over the endpoints (no browser)
// ---------------------------------------------------------------------------------------------

export interface MintedGrant {
  accessToken: string;
  refreshToken: string;
  scope: string;
  clientId: string;
  verifier: string;
}

const hiddenField = (html: string, name: string): string => {
  const match = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  if (!match) throw new Error(`the consent form has no ${name} field`);
  return match[1]!;
};

/**
 * Connects an app for the signed-in person in `context` the way a real app does: it draws the consent
 * screen, answers Allow with the given ticks, and exchanges the code. Returns the tokens.
 */
export async function mintGrant(
  context: BrowserContext,
  clientId: string,
  options: { scopes?: string[]; redirectUri?: string; ip?: string } = {},
): Promise<MintedGrant> {
  const cookie = cookieHeader(await authCookies(context));
  const pair = pkcePair();
  const redirectUri = options.redirectUri ?? CLIENT_REDIRECT;
  const ip = options.ip ?? ownIp();
  const screen = await appRaw(
    `/oauth/authorize?${authorizeQuery(clientId, pair.challenge, { redirectUri })}`,
    { cookie, headers: { "x-forwarded-for": ip } },
  );
  if (screen.status !== 200)
    throw new Error(`mintGrant: the consent screen was a ${screen.status}`);
  const form = new URLSearchParams({
    request: hiddenField(screen.body, "request"),
    csrf: hiddenField(screen.body, "csrf"),
    decision: "allow",
  });
  for (const scope of options.scopes ?? ["hydlnk.write", "hydlnk.publish"])
    form.append("scope", scope);
  const answered = await appRaw("/oauth/consent", {
    method: "POST",
    cookie,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: APP_ORIGIN,
      "x-forwarded-for": ip,
    },
    body: form.toString(),
  });
  if (answered.status !== 303 || !answered.location)
    throw new Error(`mintGrant: the answer was ${answered.status}`);
  const code = new URL(answered.location).searchParams.get("code");
  if (!code) throw new Error("mintGrant: no code in the answer");
  const tokens = await exchangeCode(clientId, code, pair.verifier, redirectUri);
  if (tokens.status !== 200) throw new Error(`mintGrant: the exchange was ${tokens.status}`);
  return {
    accessToken: String(tokens.body.access_token),
    refreshToken: String(tokens.body.refresh_token),
    scope: String(tokens.body.scope),
    clientId,
    verifier: pair.verifier,
  };
}

/** Does /mcp answer (a route exists)? The MCP side of the wave may not be built yet. */
export async function mcpAnswers(): Promise<boolean> {
  const res = await appRaw("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ownIp() },
    body: "{}",
  });
  return res.status !== 404;
}

/** The status of /mcp with a bearer token: 401 for a token that does not work. */
export async function mcpStatus(accessToken: string): Promise<number> {
  const res = await appRaw("/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-forwarded-for": ownIp(),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  return res.status;
}
