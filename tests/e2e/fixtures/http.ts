import http from "node:http";
import type { BrowserContext, Cookie } from "@playwright/test";
import { DEV_PORT } from "../helpers";
import { publishableKey, supabaseUrl } from "./auth";

/**
 * Raw HTTP and session-cookie helpers (specs for the callback, gate, host-only cookies, sign-out,
 * handles and tenant hosts). Everything that needs exact status, Location or header values talks
 * to the dev server directly, so no browser follows a redirect or adds a header.
 */

// ---------------------------------------------------------------------------------------------
// Requests with an explicit Host header
// ---------------------------------------------------------------------------------------------

export interface RawResponse {
  status: number;
  /** The Location header, as sent (Next sends it relative for same-host redirects). */
  location: string | null;
  headers: http.IncomingHttpHeaders;
  /** Every Set-Cookie header, one entry per cookie. */
  setCookies: string[];
  body: string;
}

/**
 * One request to the dev server on 127.0.0.1:3000 naming `host` (Node does not resolve *.localhost
 * reliably, Chromium does), redirects not followed. Pass `cookie` for a Cookie header. With
 * HL_DEV_PORT set (a second checkout on its own port) the request goes to that port and a host
 * written as `name.localhost:3000` is sent as `name.localhost:<port>`, so no spec needs editing.
 */
export function rawRequest(
  host: string,
  path: string,
  opts: { cookie?: string; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  const headers: Record<string, string | number> = {
    Host: host.replace(/:3000$/, `:${DEV_PORT}`),
    ...opts.headers,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-length"] = Buffer.byteLength(opts.body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: DEV_PORT, path, method: opts.method ?? "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            headers: res.headers,
            setCookies: res.headers["set-cookie"] ?? [],
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

/**
 * What a response that must never be stored may send in Cache-Control. A production build answers
 * `no-store` (the app host from the proxy, tenant pages from Next's dynamic rendering); `next dev`
 * replaces the header of every rendered page with `no-cache, must-revalidate` (base-server.js), so
 * only a run against `next start` can be strict. Run it that way with E2E_PROD_BUILD=1.
 */
export const NEVER_STORED = process.env.E2E_PROD_BUILD === "1" ? /no-store/ : /no-store|no-cache/;

/** rawRequest to the app host. */
export const appRaw = (path: string, opts?: Parameters<typeof rawRequest>[2]) =>
  rawRequest("app.localhost:3000", path, opts);

/** Absolute form of a Location header. */
export const absolute = (
  location: string | null,
  base = "http://app.localhost:3000",
): string | null => (location ? new URL(location, base).toString() : null);

// ---------------------------------------------------------------------------------------------
// The session cookie
// ---------------------------------------------------------------------------------------------

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user?: { id: string; email?: string };
}

export const isAuthCookie = (name: string) => /^sb-.*-auth-token(\.\d+)?$/.test(name);

/** The sb-...-auth-token cookies (chunks included) the context holds for the app host. */
export async function authCookies(context: BrowserContext): Promise<Cookie[]> {
  return (await context.cookies("http://app.localhost:3000")).filter((c) => isAuthCookie(c.name));
}

export function cookieHeader(cookies: Pick<Cookie, "name" | "value">[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Decodes the (possibly chunked) session cookie into the stored session. */
export function decodeSession(cookies: Pick<Cookie, "name" | "value">[]): StoredSession {
  const chunks = [...cookies].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const joined = chunks.map((c) => c.value).join("");
  const body = joined.startsWith("base64-")
    ? Buffer.from(joined.slice(7), "base64url").toString()
    : joined;
  return JSON.parse(body) as StoredSession;
}

/** The context's stored session (access and refresh token). Throws when it holds none. */
export async function sessionOf(context: BrowserContext): Promise<StoredSession> {
  const cookies = await authCookies(context);
  if (cookies.length === 0) throw new Error("no sb- auth cookie in the context");
  return decodeSession(cookies);
}

/** Encodes a session object the way @supabase/ssr stores it (single cookie, base64url). */
export function encodeSessionCookie(session: object, name = "sb-127-auth-token"): string {
  return `${name}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

// ---------------------------------------------------------------------------------------------
// Supabase over HTTP, the way curl would
// ---------------------------------------------------------------------------------------------

/** GET {SUPABASE_URL}/auth/v1/user with a bearer token. */
export async function authUser(accessToken: string): Promise<{ status: number; email?: string }> {
  const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${accessToken}`, apikey: publishableKey() },
  });
  const body = (await res.json().catch(() => ({}))) as { email?: string };
  return { status: res.status, email: body.email };
}

/** POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token. */
export async function exchangeRefreshToken(
  refreshToken: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: publishableKey(), "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

/** Asks Supabase to email a sign-in link (what the log in action does), without a browser. */
export async function requestLinkByApi(email: string): Promise<void> {
  const res = await fetch(`${supabaseUrl()}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: publishableKey(), "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error(`otp request for ${email} failed: ${res.status}`);
}

/** PostgREST with the publishable key and, when given, a user's JWT (role authenticated). */
export function postgrest(path: string, accessToken?: string): Promise<Response> {
  return fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    headers: {
      apikey: publishableKey(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
}

/** PostgREST as the signed-in user with a body and the resulting rows returned. */
export async function restAs(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${supabaseUrl()}/rest/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  return { status: res.status, body };
}
