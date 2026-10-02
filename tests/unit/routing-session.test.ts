import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOCAL_ENV = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: LOCAL_ENV }));

const { rewriteWithSession } = await import("@/lib/routing/session");

/** M1-06: the proxy's session helper, run against the real @supabase/ssr with a fake auth server. */

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const USER_ID = "22222222-2222-4222-8222-222222222222";

function jwt(expSecondsFromNow: number): string {
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({
    sub: USER_ID,
    email: "u@example.com",
    aud: "authenticated",
    role: "authenticated",
    session_id: "33333333-3333-4333-8333-333333333333",
    exp,
  })}.sig`;
}

function sessionJson(accessToken: string, refreshToken: string, expiresIn: number) {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: {
      id: USER_ID,
      email: "u@example.com",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

const COOKIE_NAME = "sb-127-auth-token";
const cookieFor = (session: object) => `${COOKIE_NAME}=base64-${b64url(session)}`;

function requestWith(cookie: string) {
  return new NextRequest("http://app.localhost:3000/", { headers: { cookie } });
}
const destination = () => new URL("http://app.localhost:3000/app");

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let tokenCalls: string[];

beforeEach(() => {
  tokenCalls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("rewriteWithSession (M1-06)", () => {
  it("refreshes an expired access token with a valid refresh token and keeps the request signed in", async () => {
    const fresh = jwt(3600);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.pathname === "/auth/v1/token") {
          tokenCalls.push(String(init?.body));
          return json(200, sessionJson(fresh, "refresh-2", 3600));
        }
        if (url.pathname === "/auth/v1/user") {
          return json(200, sessionJson(fresh, "x", 1).user);
        }
        return json(404, {});
      }),
    );

    const request = requestWith(cookieFor(sessionJson(jwt(-600), "refresh-1", -600)));
    const response = await rewriteWithSession(request, destination());

    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]).toContain("refresh-1");

    const setCookies = response.headers.getSetCookie();
    const auth = setCookies.filter((c) => c.startsWith(COOKIE_NAME));
    expect(auth.length).toBeGreaterThan(0);
    for (const header of auth) {
      expect(header).not.toMatch(/;\s*domain=/i); // host-only
      expect(header).not.toMatch(/;\s*secure/i); // plain http on localhost
      expect(header).toMatch(/;\s*path=\//i);
      expect(header).toMatch(/samesite=lax/i);
    }
    // Server Components in this same request must see the refreshed session too.
    const forwarded = request.cookies.get(COOKIE_NAME)?.value ?? "";
    const stored = JSON.parse(
      Buffer.from(forwarded.replace(/^base64-/, ""), "base64url").toString(),
    );
    expect(stored.refresh_token).toBe("refresh-2");
    // Everything the app host serves is session-dependent, so it is never stored (M1-07).
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sets the refreshed cookies Secure and host-only when the site is served over https", async () => {
    // M1-06 step 8, the part a local http run cannot see: production serves https, and
    // @supabase/ssr never sets the Secure flag itself.
    vi.resetModules();
    vi.doMock("@/lib/env/client", () => ({
      clientEnv: {
        NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.com",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
    }));
    const fresh = jwt(3600);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.pathname === "/auth/v1/token")
          return json(200, sessionJson(fresh, "refresh-2", 3600));
        if (url.pathname === "/auth/v1/user") return json(200, sessionJson(fresh, "x", 1).user);
        return json(404, {});
      }),
    );
    try {
      const { rewriteWithSession: secure } = await import("@/lib/routing/session");
      const request = new NextRequest("https://app.hydlnk.com/", {
        headers: { cookie: cookieFor(sessionJson(jwt(-600), "refresh-1", -600)) },
      });
      const response = await secure(request, new URL("https://app.hydlnk.com/app"));
      const auth = response.headers.getSetCookie().filter((c) => c.startsWith(COOKIE_NAME));
      expect(auth.length).toBeGreaterThan(0);
      for (const header of auth) {
        expect(header).toMatch(/;\s*secure/i);
        expect(header).not.toMatch(/;\s*domain=/i);
        expect(header).toMatch(/samesite=lax/i);
      }
    } finally {
      // Back to the local env the other cases (and the isolated import below) use.
      vi.doMock("@/lib/env/client", () => ({ clientEnv: LOCAL_ENV }));
      vi.resetModules();
    }
  });

  it("clears the cookies and treats the request as signed out when the refresh token is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (url.pathname === "/auth/v1/token") {
          return json(400, {
            code: 400,
            error_code: "refresh_token_not_found",
            msg: "Invalid Refresh Token: Refresh Token Not Found",
          });
        }
        return json(401, {});
      }),
    );

    const request = requestWith(cookieFor(sessionJson(jwt(-600), "revoked", -600)));
    const response = await rewriteWithSession(request, destination());

    const cleared = response.headers
      .getSetCookie()
      .filter((c) => c.startsWith(COOKIE_NAME))
      .map((c) => ({
        empty: new RegExp(`^${COOKIE_NAME}(\\.\\d+)?=;`).test(c),
        expired: /max-age=0|expires=thu, 01 jan 1970/i.test(c),
      }));
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((c) => c.empty && c.expired)).toBe(true);
    // Whatever Server Components read from this request is now empty.
    expect(request.cookies.get(COOKIE_NAME)?.value ?? "").toBe("");
  });

  it("makes no auth call and sets no cookie for a request without a session", async () => {
    const fetchMock = vi.fn(async () => json(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    const response = await rewriteWithSession(
      new NextRequest("http://app.localhost:3000/login"),
      destination(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Never framed by another site, never sniffed.
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("an unreachable auth server does not take the app host down", async () => {
    // The real client retries network errors for a long while; what matters here is the proxy's
    // own catch, so this one case swaps in a client whose getClaims() throws at once.
    vi.resetModules();
    vi.doMock("@supabase/ssr", () => ({
      createServerClient: () => ({
        auth: {
          getClaims: async () => {
            throw new TypeError("fetch failed");
          },
        },
      }),
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { rewriteWithSession: isolated } = await import("@/lib/routing/session");
      const request = requestWith(cookieFor(sessionJson(jwt(-600), "refresh-1", -600)));
      const response = await isolated(request, destination());
      // Still a rewrite to the app route; pages that need a session check it themselves.
      expect(response.headers.get("x-middleware-rewrite")).toBe(destination().toString());
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
      vi.doUnmock("@supabase/ssr");
      vi.resetModules();
    }
  });
});
