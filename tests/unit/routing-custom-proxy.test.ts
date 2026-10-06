import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-09 in the proxy: what a custom host is rewritten to, what is left alone, and what never
 * happens (no cookies in, no cookies out, no direct /sites, no host other than the real Host).
 */

const LOCAL_ENV = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: LOCAL_ENV }));
vi.mock("@/lib/routing/session", () => ({
  rewriteWithSession: vi.fn(async (_request: NextRequest, url: URL) => NextResponse.rewrite(url)),
}));
const resolveCustomDomain = vi.fn<(host: string) => Promise<string | null>>();
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain }));

const { proxy } = await import("@/proxy");

const PAGE = "11111111-1111-4111-8111-111111111111";

const request = (host: string, path = "/", headers: Record<string, string> = {}, method = "GET") =>
  new NextRequest(`http://${host}${path}`, { method, headers: { host, ...headers } });

const rewriteOf = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
};
const passedThrough = (response: Response) =>
  response.headers.get("x-middleware-next") === "1" &&
  !response.headers.has("x-middleware-rewrite");

beforeEach(() => {
  resolveCustomDomain.mockReset();
});

describe("M4-09 a verified custom host", () => {
  it("is rewritten to /sites/<pageId> and /sites/<pageId>/og; a path that cannot be a sub-page is the one plain 404 (/sites/unknown), all with the tenant security headers", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    for (const [path, expected] of [
      ["/", `/sites/${PAGE}`],
      ["/og", `/sites/${PAGE}/og`],
      // A one-segment lowercase path is a sub-page (M11-06): the dynamic route answers it.
      ["/login", `/sites/${PAGE}/p/login`],
      ["/anything-else", `/sites/${PAGE}/p/anything-else`],
      ["/Items", "/sites/unknown"],
      ["/a/b", "/sites/unknown"],
      ["/api", "/sites/unknown"],
      ["/hl-query-count", "/sites/unknown"],
    ] as const) {
      const response = await proxy(request("links.example.org", path));
      expect(rewriteOf(response), path).toBe(expected);
      expect(response.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
      expect(response.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("is looked up by its real Host header, case, port and trailing dot included (the lookup normalises)", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    await proxy(request("LINKS.Example.Org:3000"));
    expect(resolveCustomDomain).toHaveBeenCalledWith("LINKS.Example.Org:3000");
  });

  it("reads only the real Host: X-Forwarded-Host and X-Original-Host naming another hostname are ignored", async () => {
    resolveCustomDomain.mockImplementation(async (host) =>
      host === "known.example.org" ? PAGE : null,
    );
    const spoofed = await proxy(
      request("unknown.example.org", "/", {
        "x-forwarded-host": "known.example.org",
        "x-original-host": "known.example.org",
        forwarded: "host=known.example.org",
      }),
    );
    expect(rewriteOf(spoofed)).toBe("/sites/unknown");
    expect(resolveCustomDomain.mock.calls.map((c) => c[0])).toEqual(["unknown.example.org"]);

    // And the other way round: the spoofed header cannot take a known host away either.
    const real = await proxy(
      request("known.example.org", "/", { "x-forwarded-host": "unknown.example.org" }),
    );
    expect(rewriteOf(real)).toBe(`/sites/${PAGE}`);
  });

  it("drops the request's cookies before the page renders and sets none: an sb-* cookie goes nowhere", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    const response = await proxy(
      request("links.example.org", "/", { cookie: "sb-127-auth-token=base64-abc; other=1" }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers") ?? "").not.toMatch(/cookie/);
    // The other request headers still travel.
    expect(response.headers.get("x-middleware-override-headers") ?? "").toMatch(/host/);
  });

  it("leaves /r/* and /api/e unrewritten (and cookie-free), for every method", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    for (const [path, method] of [
      ["/r/11111111-1111-4111-8111-111111111111/abcdefgh1", "GET"],
      ["/r/x", "GET"],
      ["/api/e", "POST"],
    ] as const) {
      const response = await proxy(
        request("links.example.org", path, { cookie: "sb-127-auth-token=x" }, method),
      );
      expect(passedThrough(response), `${method} ${path}`).toBe(true);
      expect(response.headers.get("x-middleware-override-headers") ?? "").not.toMatch(/cookie/);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("other /api paths and look-alikes are the tenant 404, not passed through", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    for (const path of [
      "/api/stripe/webhook",
      "/api/e/extra",
      "/api/ee",
      "/r",
      "/rr/x",
      "/api",
      "/api/cron/verify-domains",
      "/auth/callback",
      "/auth",
    ]) {
      const response = await proxy(request("links.example.org", path));
      expect(rewriteOf(response), path).toBe("/sites/unknown");
    }
    // The app's own screen names are plain sub-page shapes on a custom host (M11-06): the dynamic
    // sub-page route answers the 404 of a path that is not a live page, never the app route.
    for (const path of ["/settings", "/domains", "/analytics", "/signup"]) {
      const response = await proxy(request("links.example.org", path));
      expect(rewriteOf(response), path).toBe(`/sites/${PAGE}/p/${path.slice(1)}`);
    }
  });
});

describe("M4-09 everything else on a custom host is the plain 404", () => {
  it("an unknown host, a pending or draft-only domain and a failing lookup all rewrite to /sites/unknown with no tenant data", async () => {
    resolveCustomDomain.mockResolvedValue(null);
    const response = await proxy(
      request("nobody.example.org", "/", { cookie: "sb-127-auth-token=x" }),
    );
    expect(rewriteOf(response)).toBe("/sites/unknown");
    expect(response.headers.get("content-security-policy")).toBeTruthy();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers") ?? "").not.toMatch(/cookie/);
  });

  it("an unresolved host does not get /r/* or /api/e either", async () => {
    resolveCustomDomain.mockResolvedValue(null);
    for (const [path, method] of [
      ["/r/a/b", "GET"],
      ["/api/e", "POST"],
    ] as const) {
      const response = await proxy(request("nobody.example.org", path, {}, method));
      expect(rewriteOf(response)).toBe("/sites/unknown");
    }
  });

  it("a lookup that throws is a 404, not a 500", async () => {
    resolveCustomDomain.mockImplementation(async () => {
      throw new Error("database down");
    });
    const response = await proxy(request("links.example.org"));
    expect(rewriteOf(response)).toBe("/sites/unknown");
  });
});

describe("M4-09 the internal /sites route is unreachable directly, on every host", () => {
  const path = `/sites/${PAGE}`;

  it("marketing hosts answer the 404 sentinel", async () => {
    for (const host of ["localhost:3000", "hydlnk-abc.vercel.app"]) {
      expect(rewriteOf(await proxy(request(host, path)))).toBe("/404-not-found");
    }
  });

  it("the app host nests it under /app (no such route), a tenant host answers the one plain 404", async () => {
    expect(rewriteOf(await proxy(request("app.localhost:3000", path)))).toBe(`/app${path}`);
    expect(rewriteOf(await proxy(request("mara.localhost:3000", path)))).toBe("/sites/unknown");
  });

  it("a custom host never serves it as another page: the plain 404, whoever the host resolves to", async () => {
    resolveCustomDomain.mockResolvedValue("22222222-2222-4222-8222-222222222222");
    const response = await proxy(request("links.example.org", path));
    expect(rewriteOf(response)).toBe("/sites/unknown");
    resolveCustomDomain.mockResolvedValue(null);
    expect(rewriteOf(await proxy(request("links.example.org", path)))).toBe("/sites/unknown");
  });
});

describe("tracking routes on tenant hosts (the page emits them as relative URLs)", () => {
  it("/r/* and /api/e are left unrewritten on a handle host, the page and /og still go to /t/<handle>", async () => {
    for (const [path, method] of [
      ["/r/11111111-1111-4111-8111-111111111111/abcdefgh1", "GET"],
      ["/api/e", "POST"],
    ] as const) {
      expect(
        passedThrough(await proxy(request("mara.localhost:3000", path, {}, method))),
        path,
      ).toBe(true);
    }
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/")))).toBe("/t/mara");
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/og")))).toBe("/t/mara/og");
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/api/stripe/webhook")))).toBe(
      "/sites/unknown",
    );
  });
});

describe("the sweep and polling routes live on the app host only", () => {
  it("a tenant, marketing or custom host never reaches them", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    // A POST on a tenant or custom host is the plain 404 right in the proxy (M8-02): it is never rewritten to
    // an app route, and a custom host is not even looked up for it.
    for (const host of ["mara.localhost:3000", "links.example.org"]) {
      const response = await proxy(request(host, "/api/cron/verify-domains", {}, "POST"));
      expect(response.status, host).toBe(404);
      expect(rewriteOf(response), host).toBeNull();
    }
    expect(rewriteOf(await proxy(request("links.example.org", "/api/domains/x")))).toBe(
      "/sites/unknown",
    );
    expect(
      rewriteOf(await proxy(request("app.localhost:3000", "/api/cron/verify-domains", {}, "POST"))),
    ).toBe("/app/api/cron/verify-domains");
  });
});
