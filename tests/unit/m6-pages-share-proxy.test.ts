import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOCAL_ENV = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: LOCAL_ENV }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { VISITOR_HASH_SECRET: "unit-test-secret" } }));

const rewriteWithSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/routing/session", () => ({ rewriteWithSession }));
const shareRateLimit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/previews/share-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/previews/share-limit")>()),
  shareRateLimit,
}));
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain: vi.fn(async () => null) }));

const { proxy } = await import("@/proxy");
const {
  SHARE_TOKEN_HEADER,
  isSharePath,
  rateLimitedHtml,
  setShareHeaders,
  shareContentSecurityPolicy,
  shareNonce,
  shareSegment,
} = await import("@/lib/previews/share-headers");
const { shareProxy } = await import("@/lib/previews/share-proxy");
const limiter = await vi.importActual<typeof import("@/lib/previews/share-limit")>(
  "@/lib/previews/share-limit",
);
const { rateLimit } = await import("@/lib/rate-limit");
const { TENANT_CONTENT_SECURITY_POLICY } = await import("@/lib/routing/tenant-headers");
const { INACTIVE_LINK_MESSAGE } = await import("@/lib/previews/messages");

/**
 * M6-10: how the proxy treats /share/* on the app host. It only rewrites (no session read, no
 * Set-Cookie, cookies dropped before the page), hands the first path segment to the page in a
 * request header, sets the share headers, and rate limits by IP with a real 429 and Retry-After.
 */

const TOKEN = "A".repeat(43);
const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://app.localhost:3000${path}`, {
    headers: { host: "app.localhost:3000", ...headers },
  });

beforeEach(() => {
  rewriteWithSession.mockReset();
  rewriteWithSession.mockImplementation(async (_r: NextRequest, url: URL) =>
    NextResponse.rewrite(url),
  );
  shareRateLimit.mockReset();
  shareRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
});

describe("M6-10 share paths", () => {
  it("isSharePath matches /share and /share/..., not look-alikes", () => {
    expect(isSharePath("/share")).toBe(true);
    expect(isSharePath(`/share/${TOKEN}`)).toBe(true);
    expect(isSharePath(`/share/${TOKEN}/extra/path`)).toBe(true);
    expect(isSharePath("/shared")).toBe(false);
    expect(isSharePath("/sharex/abc")).toBe(false);
    expect(isSharePath("/editor")).toBe(false);
    expect(isSharePath("/app/share")).toBe(false);
  });

  it("shareSegment is the first segment after /share/, kept short and plain", () => {
    expect(shareSegment(`/share/${TOKEN}`)).toBe(TOKEN);
    expect(shareSegment(`/share/${TOKEN}/extra`)).toBe(TOKEN);
    expect(shareSegment("/share/abc")).toBe("abc");
    expect(shareSegment("/share")).toBe("");
    expect(shareSegment("/share/")).toBe("");
    expect(shareSegment("/share/../x")).toBe("..");
    expect(shareSegment(`/share/${"x".repeat(100)}`)).toHaveLength(64);
    // Not plain printable ASCII: nothing is handed over, so a header can never be malformed.
    expect(shareSegment("/share/café")).toBe("");
    expect(shareSegment("/share/a b")).toBe("");
  });
});

/** The four directives the tenant policy has, in order: every share policy starts with them. */
const TENANT_DIRECTIVES =
  "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const NONCE_SHAPE = /^[A-Za-z0-9+/]{22}==$/;
/** The nonce a policy names in its script-src (null when it names none). */
const nonceOf = (policy: string | null): string | null =>
  /'nonce-([^']+)'/.exec(policy ?? "")?.[1] ?? null;

describe("M6-10 response headers", () => {
  it("never stored, never indexed, no Referer, the tenant CSP plus a script policy, no sniffing, no framing", () => {
    const headers = new Headers();
    setShareHeaders(headers, "AAAAAAAAAAAAAAAAAAAAAA==");
    expect(headers.get("cache-control")).toBe("private, no-store");
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("content-security-policy")).toBe(
      `${TENANT_CONTENT_SECURITY_POLICY}; script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA==' 'strict-dynamic'; script-src-attr 'none'; form-action 'none'`,
    );
    expect(headers.get("content-security-policy")?.startsWith(`${TENANT_DIRECTIVES}; `)).toBe(true);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("M6-10 the share Content-Security-Policy: the app host's origin runs only scripts it nonced", () => {
  it("script-src is the nonce plus strict-dynamic: no unsafe-inline, no host list, no unsafe-eval in production", () => {
    const policy = shareContentSecurityPolicy("abc", false);
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/script-src[^;]*https?:/);
    expect(policy).not.toContain("*");
  });

  it("inline event handlers and form posts are refused outright", () => {
    const policy = shareContentSecurityPolicy("abc", false);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("form-action 'none'");
  });

  it("keeps the four tenant directives, unchanged and first", () => {
    expect(shareContentSecurityPolicy("abc", false).startsWith(`${TENANT_DIRECTIVES}; `)).toBe(
      true,
    );
    expect(TENANT_CONTENT_SECURITY_POLICY).toBe(TENANT_DIRECTIVES);
  });

  it("only the development server gets unsafe-eval (React's debugging needs it there)", () => {
    expect(shareContentSecurityPolicy("abc", true)).toContain(
      "'strict-dynamic' 'unsafe-eval'; script-src-attr 'none'",
    );
    expect(shareContentSecurityPolicy("abc", false)).not.toContain("unsafe-eval");
  });

  it("with no nonce (a page that carries no script) no script runs at all", () => {
    const policy = shareContentSecurityPolicy(null, false);
    expect(policy).toContain("script-src 'none'");
    expect(policy).not.toContain("nonce-");
    expect(policy).not.toContain("strict-dynamic");
    const headers = new Headers();
    setShareHeaders(headers);
    expect(headers.get("content-security-policy")).toBe(policy);
  });

  it("a nonce is 16 random bytes in base64, and no two are alike", () => {
    const nonces = Array.from({ length: 50 }, () => shareNonce());
    for (const nonce of nonces) expect(nonce).toMatch(NONCE_SHAPE);
    expect(new Set(nonces).size).toBe(50);
  });
});

describe("M6-10 the proxy branch for /share/*", () => {
  it("rewrites to the internal route, sets the headers, and never touches the session", async () => {
    const response = await proxy(
      request(`/share/${TOKEN}`, { cookie: "sb-127-auth-token=base64-abc; other=1" }),
    );
    expect(rewriteWithSession).not.toHaveBeenCalled();
    expect(response.headers.get("x-middleware-rewrite")).toBe(
      "http://app.localhost:3000/app/share",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("sets the script policy with a fresh nonce on the response and on the request the page renders from", async () => {
    const first = await proxy(request(`/share/${TOKEN}`));
    const second = await proxy(request(`/share/${TOKEN}`));
    const responseCsp = first.headers.get("content-security-policy");
    const nonce = nonceOf(responseCsp);
    expect(nonce).toMatch(NONCE_SHAPE);
    expect(responseCsp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(responseCsp?.startsWith(`${TENANT_DIRECTIVES}; `)).toBe(true);
    // Next.js reads the nonce from the request's CSP header and puts it on its own scripts.
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(responseCsp);
    expect(first.headers.get("x-middleware-override-headers")).toContain("content-security-policy");
    // A new nonce for every request.
    expect(nonceOf(second.headers.get("content-security-policy"))).not.toBe(nonce);
  });

  it("replaces a CSP a client sent: the page never renders under a nonce the visitor chose", async () => {
    const response = await shareProxy(
      request(`/share/${TOKEN}`, {
        "content-security-policy": "script-src 'nonce-attacker'",
        "content-security-policy-report-only": "script-src 'nonce-attacker'",
      }),
      new URL("http://app.localhost:3000/app/share"),
      async () => ({ allowed: true, retryAfter: 0 }),
    );
    const forwarded = response.headers.get("x-middleware-request-content-security-policy");
    expect(forwarded).not.toContain("attacker");
    expect(forwarded).toBe(response.headers.get("content-security-policy"));
    expect(
      response.headers.get("x-middleware-request-content-security-policy-report-only"),
    ).toBeNull();
    const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(overridden).not.toContain("content-security-policy-report-only");
  });

  it("hands the segment over in a request header and drops the cookies and a forged header", async () => {
    const response = await shareProxy(
      request(`/share/${TOKEN}`, {
        cookie: "sb-127-auth-token=secret",
        [SHARE_TOKEN_HEADER]: "forged-by-the-client",
      }),
      new URL("http://app.localhost:3000/app/share"),
      async () => ({ allowed: true, retryAfter: 0 }),
    );
    expect(response.headers.get(`x-middleware-request-${SHARE_TOKEN_HEADER}`)).toBe(TOKEN);
    const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(overridden).not.toContain("cookie");
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
  });

  it("ignores everything else in the URL: an extra path, a query string and a ?page= parameter", async () => {
    const response = await shareProxy(
      request(`/share/${TOKEN}/other/path?page=00000000-0000-4000-8000-000000000001&x=1`),
      new URL("http://app.localhost:3000/app/share"),
      async () => ({ allowed: true, retryAfter: 0 }),
    );
    expect(response.headers.get(`x-middleware-request-${SHARE_TOKEN_HEADER}`)).toBe(TOKEN);
  });

  it("other app-host paths still go through the session helper", async () => {
    await proxy(request("/editor"));
    await proxy(request("/shared"));
    expect(rewriteWithSession).toHaveBeenCalledTimes(2);
  });

  it("only the app host: the root host and a tenant host get no share handling", async () => {
    const root = await proxy(
      new NextRequest(`http://localhost:3000/share/${TOKEN}`, {
        headers: { host: "localhost:3000" },
      }),
    );
    expect(root.headers.get("x-robots-tag")).toBeNull();
    expect(shareRateLimit).not.toHaveBeenCalled();
    const tenant = await proxy(
      new NextRequest(`http://mara.localhost:3000/share/${TOKEN}`, {
        headers: { host: "mara.localhost:3000" },
      }),
    );
    expect(tenant.headers.get("x-middleware-rewrite")).toBe(
      "http://mara.localhost:3000/t/mara/share/" + TOKEN,
    );
    expect(shareRateLimit).not.toHaveBeenCalled();
  });
});

describe("M6-10 the rate limit: share:{ip}, 60 a minute, a real 429", () => {
  it("answers 429 with Retry-After, the plain page and the share headers", async () => {
    shareRateLimit.mockResolvedValue({ allowed: false, retryAfter: 17 });
    const response = await proxy(
      request(`/share/${TOKEN}`, {
        "x-forwarded-for": "203.0.113.9",
        cookie: "sb-127-auth-token=x",
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    // The plain page has no script, so no script may run on it.
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("content-security-policy")).not.toContain("nonce-");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    const body = await response.text();
    expect(body).toContain(INACTIVE_LINK_MESSAGE);
    expect(body).toBe(rateLimitedHtml());
    expect(body).not.toContain(TOKEN);
    expect(rewriteWithSession).not.toHaveBeenCalled();
  });

  it("counts by client key: the IPv4 address, so another IP has its own bucket", async () => {
    await proxy(request(`/share/${TOKEN}`, { "x-forwarded-for": "203.0.113.9" }));
    await proxy(request(`/share/${TOKEN}`, { "x-forwarded-for": "203.0.113.10" }));
    await proxy(request(`/share/${TOKEN}`));
    expect(shareRateLimit.mock.calls.map((call) => call[0])).toEqual([
      "203.0.113.9",
      "203.0.113.10",
      "unknown",
    ]);
  });

  it("every request counts, a malformed token too (nothing is looked up before the limit)", async () => {
    await proxy(request("/share/abc"));
    await proxy(request("/share"));
    expect(shareRateLimit).toHaveBeenCalledTimes(2);
  });
});

describe("M6-10 the proxy's limiter is the same limiter as rateLimit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds the very bucket rateLimit('share:{ip}') builds", async () => {
    const seen: string[] = [];
    const store = {
      async hit(bucket: string) {
        seen.push(bucket);
        return { allowed: true, retryAfter: 0 };
      },
    };
    await rateLimit("share:203.0.113.9", 60, 60, { store, secret: "parity-secret" });
    await limiter.shareRateLimit("203.0.113.9", {
      store: { hit: async (b) => (seen.push(b), { allowed: true, retryAfter: 0 }) },
      secret: "parity-secret",
    });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[1]).toBe(seen[0]);
    expect(limiter.shareBucket("203.0.113.9", "parity-secret")).toBe(seen[0]);
  });

  it("asks for 60 requests in 60 seconds and never hands over the address", async () => {
    const hit = vi.fn(async () => ({ allowed: true, retryAfter: 0 }));
    await limiter.shareRateLimit("203.0.113.9", { store: { hit }, secret: "s" });
    expect(hit).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/), 60, 60);
    expect(JSON.stringify(hit.mock.calls)).not.toContain("203.0.113.9");
  });

  it("passes a store's refusal through with its retryAfter", async () => {
    const result = await limiter.shareRateLimit("203.0.113.9", {
      store: { hit: async () => ({ allowed: false, retryAfter: 42 }) },
      secret: "s",
    });
    expect(result).toEqual({ allowed: false, retryAfter: 42 });
  });

  it("a limiter failure lets the request through and logs without the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await limiter.shareRateLimit("203.0.113.9", {
      store: {
        hit: async () => {
          throw new Error("the database is down");
        },
      },
      secret: "very-secret-value",
    });
    expect(result).toEqual({ allowed: true, retryAfter: 0 });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain("the database is down");
    expect(logged).not.toContain("203.0.113.9");
    expect(logged).not.toContain("very-secret-value");
  });

  it("a limiter that does not answer in time lets the request through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await limiter.shareRateLimit("203.0.113.9", {
      store: { hit: () => new Promise(() => undefined) },
      secret: "s",
      timeoutMs: 20,
    });
    expect(result).toEqual({ allowed: true, retryAfter: 0 });
  });

  it("an unconfigured limiter lets the request through", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await limiter.shareRateLimit("203.0.113.9", { store: null, secret: "s" })).toEqual({
      allowed: true,
      retryAfter: 0,
    });
    expect(
      await limiter.shareRateLimit("203.0.113.9", {
        store: { hit: async () => ({ allowed: false, retryAfter: 5 }) },
        secret: null,
      }),
    ).toEqual({ allowed: true, retryAfter: 0 });
  });
});
