import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
const m = vi.hoisted(() => ({ verdict: { allowed: true, retryAfter: 0 } }));
const proxyRateLimit = vi.hoisted(() => vi.fn(async () => m.verdict));
vi.mock("@/lib/previews/share-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/previews/share-limit")>()),
  proxyRateLimit,
}));
const rewriteWithSession = vi.hoisted(() => vi.fn(async (_r: NextRequest, url: URL) => NextResponse.rewrite(url)));
vi.mock("@/lib/routing/session", () => ({ rewriteWithSession }));
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain: vi.fn() }));

const { proxy } = await import("@/proxy");
const { INVITE_LINK_LIMIT, INVITE_LINK_WINDOW_SECONDS } = await import("@/lib/routing/invite-limit");

/**
 * Team access attack pass, note 4b (M19-08): GET /invite/{token} is rate limited in the proxy per
 * client address, like /share/* (30 a minute, `invite-link:{ip}`), before the session is read. Over
 * the limit: 429 with Retry-After, never stored, no Referer, and the route never runs.
 */
const TOKEN = "A".repeat(43);
const get = (path: string) =>
  proxy(new NextRequest(`http://app.localhost:3000${path}`, { headers: { host: "app.localhost:3000", "x-forwarded-for": "203.0.113.9" } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.verdict = { allowed: true, retryAfter: 0 };
});

describe("note 4b: the invite link's proxy rate limit", () => {
  it("counts one request on invite-link:{ip}, 30 a minute, then goes on to the session path", async () => {
    await get(`/invite/${TOKEN}`);
    expect(proxyRateLimit).toHaveBeenCalledWith("invite-link:203.0.113.9", INVITE_LINK_LIMIT, INVITE_LINK_WINDOW_SECONDS);
    expect([INVITE_LINK_LIMIT, INVITE_LINK_WINDOW_SECONDS]).toEqual([30, 60]);
    expect(rewriteWithSession).toHaveBeenCalledTimes(1);
  });

  it("over the limit: 429 with Retry-After, no-store and no-referrer; the session path never runs", async () => {
    m.verdict = { allowed: false, retryAfter: 17 };
    const res = await get(`/invite/${TOKEN}`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(rewriteWithSession).not.toHaveBeenCalled();
  });

  it("other app paths (and /invite itself) are not counted here", async () => {
    await get("/invite");
    await get("/editor");
    expect(proxyRateLimit).not.toHaveBeenCalled();
  });
});
