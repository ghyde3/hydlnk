import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const LOCAL_ENV = vi.hoisted(() => ({
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
}));
vi.mock("@/lib/env/client", () => ({ clientEnv: LOCAL_ENV }));

// The app-host branch is the session helper's business (routing-session.test.ts); here it is a stub.
vi.mock("@/lib/routing/session", () => ({
  rewriteWithSession: vi.fn(async (_request: NextRequest, url: URL) => NextResponse.rewrite(url)),
}));
const resolveCustomDomain = vi.fn<(host: string) => Promise<string | null>>();
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain }));

const { proxy } = await import("@/proxy");
const { TENANT_CONTENT_SECURITY_POLICY, TENANT_PAGE_CSP, FRAME_ORIGINS, setTenantHeaders } =
  await import("@/lib/routing/tenant-headers");

/** M2-22: the response headers of the public page, set by the proxy on the tenant and custom branches. */

const request = (host: string, path = "/") =>
  new NextRequest(`http://${host}${path}`, { headers: { host } });
const TENANT_HEADERS = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
] as const;

beforeEach(() => resolveCustomDomain.mockReset());

describe("M8-07 the CSP of a live tenant page", () => {
  it("is exactly the closed policy: script-src 'self', one directive per resource type, the nine embed origins, no framing", () => {
    expect(TENANT_PAGE_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' http://localhost:3000; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("allows no inline or eval script, no nonce, no wildcard and no data: source in script-src", () => {
    const script = /script-src ([^;]+)/.exec(TENANT_PAGE_CSP)![1];
    expect(script).toBe("'self'");
    expect(TENANT_PAGE_CSP).not.toMatch(/unsafe-eval|nonce-|\*|data:/);
    // 'unsafe-inline' is the one inline allowance, for styles only (the theme is inline --t-* properties).
    expect(TENANT_PAGE_CSP.match(/unsafe-inline/g)).toHaveLength(1);
    expect(/style-src ([^;]+)/.exec(TENANT_PAGE_CSP)![1]).toBe("'unsafe-inline'");
  });

  it("the nine frame origins are one list that both tenant policies are built from", () => {
    expect(FRAME_ORIGINS).toHaveLength(9);
    for (const policy of [TENANT_PAGE_CSP, TENANT_CONTENT_SECURITY_POLICY]) {
      expect(/frame-src ([^;]+)/.exec(policy)![1]).toBe(FRAME_ORIGINS.join(" "));
    }
  });

  it("TENANT_CONTENT_SECURITY_POLICY is untouched, byte for byte: the private share policy extends it", () => {
    expect(TENANT_CONTENT_SECURITY_POLICY).toBe(
      "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; img-src 'self' http://localhost:3000; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(TENANT_CONTENT_SECURITY_POLICY).not.toMatch(/script-src|nonce|default-src/);
  });

  it("setTenantHeaders sets the four security headers, with the page policy", () => {
    const headers = new Headers();
    setTenantHeaders(headers);
    expect(headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.has("set-cookie")).toBe(false);
  });

  it("is built from constants of its module: nothing in tenant-headers.ts reads a request", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/routing/tenant-headers.ts", "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(source).not.toMatch(/\b(request|Request|req)\b|headers\.get|x-forwarded|NextRequest/i);
  });
});

describe("M2-22 the proxy puts those headers on tenant and custom-domain responses only", () => {
  it("a handle host is rewritten to /t/<handle> (the page and /og) or to the one plain 404 (every other path), with the headers", async () => {
    for (const path of ["/", "/x", "/og"]) {
      const response = await proxy(request("mara.localhost:3000", path));
      const rewrite = response.headers.get("x-middleware-rewrite") ?? "";
      expect(new URL(rewrite).pathname).toBe(
        path === "/" ? "/t/mara" : path === "/og" ? "/t/mara/og" : "/sites/unknown",
      );
      for (const name of TENANT_HEADERS)
        expect(response.headers.get(name), `${path} ${name}`).toBeTruthy();
      expect(response.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
    }
  });

  it("a custom domain gets them too, known or not (the unknown-site 404 is a tenant page as well)", async () => {
    resolveCustomDomain.mockResolvedValueOnce("page-1");
    const known = await proxy(request("links.example.org"));
    expect(new URL(known.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/sites/page-1");
    expect(known.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);

    resolveCustomDomain.mockResolvedValueOnce(null);
    const unknown = await proxy(request("nobody.example.org"));
    expect(new URL(unknown.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(
      "/sites/unknown",
    );
    expect(unknown.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
  });

  it("the marketing, www and app hosts do not get the tenant policy", async () => {
    const marketing = await proxy(request("localhost:3000"));
    expect(marketing.headers.get("content-security-policy")).toBeNull();

    const www = await proxy(request("www.localhost:3000"));
    expect(www.status).toBe(308);
    expect(www.headers.get("content-security-policy")).toBeNull();

    const app = await proxy(request("app.localhost:3000", "/editor"));
    expect(app.headers.get("content-security-policy")).not.toBe(TENANT_PAGE_CSP);
    expect(app.headers.get("content-security-policy")).not.toBe(TENANT_CONTENT_SECURITY_POLICY);
  });
});

describe("M8-07 the header set is the same everywhere and is never built from the request", () => {
  it("a custom host, a handle host and the unknown-host 404 carry the same four headers, whatever the request says", async () => {
    resolveCustomDomain.mockResolvedValue("page-1");
    const spoof = {
      "x-forwarded-host": "evil.example",
      "x-original-host": "evil.example",
      cookie: "sb-token=secret",
      "user-agent": "Mozilla/5.0 (iPhone)",
    };
    const make = (host: string) =>
      new NextRequest(`http://${host}/`, { headers: { host, ...spoof } });
    const responses = [
      await proxy(make("mara.localhost:3000")),
      await proxy(make("links.example.org")),
      await proxy(make("nobody.example.org")),
    ];
    for (const response of responses) {
      for (const name of TENANT_HEADERS) {
        expect(response.headers.get(name), name).toBe(responses[0]!.headers.get(name));
      }
      expect(response.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
      expect(response.headers.has("set-cookie")).toBe(false);
    }
  });
});

describe("M8-02 a tenant page answers GET and HEAD only", () => {
  const methodRequest = (host: string, method: string, path = "/") =>
    new NextRequest(`http://${host}${path}`, { method, headers: { host } });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "%s on a handle host is 405 with Allow: GET, HEAD and the tenant headers, never the page",
    async (method) => {
      const response = await proxy(methodRequest("mara.localhost:3000", method));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
      expect(response.headers.has("set-cookie")).toBe(false);
    },
  );

  it("GET and HEAD are rewritten as before", async () => {
    for (const method of ["GET", "HEAD"]) {
      const response = await proxy(methodRequest("mara.localhost:3000", method));
      expect(new URL(response.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/t/mara");
    }
  });

  it("only the page is a 405: every other path is the plain 404 for a method that is not GET or HEAD, with the headers and no body", async () => {
    for (const path of [
      "/anything",
      "/login",
      "/og",
      "/hl-query-count",
      "/app/api/domains/x.png",
    ]) {
      const response = await proxy(methodRequest("mara.localhost:3000", "DELETE", path));
      expect(response.status, path).toBe(404);
      expect(response.headers.get("allow"), path).toBeNull();
      expect(response.headers.get("x-middleware-rewrite"), path).toBeNull();
      expect(response.headers.get("content-security-policy"), path).toBe(TENANT_PAGE_CSP);
      expect(response.headers.has("set-cookie"), path).toBe(false);
    }
  });

  it("the tracking routes are not the page: POST /api/e and GET /r/... pass through untouched", async () => {
    const beacon = await proxy(methodRequest("mara.localhost:3000", "POST", "/api/e"));
    expect(beacon.headers.get("x-middleware-next")).toBe("1");
    expect(beacon.status).toBe(200);
    const click = await proxy(methodRequest("mara.localhost:3000", "GET", "/r/page/block"));
    expect(click.headers.get("x-middleware-next")).toBe("1");
  });

  it("a custom host answers 405 on the page without a lookup, and passes POST /api/e when it resolves", async () => {
    resolveCustomDomain.mockReset();
    const denied = await proxy(methodRequest("links.example.org", "POST"));
    expect(denied.status).toBe(405);
    expect(denied.headers.get("allow")).toBe("GET, HEAD");
    expect(resolveCustomDomain).not.toHaveBeenCalled();

    resolveCustomDomain.mockResolvedValueOnce("page-1");
    const beacon = await proxy(methodRequest("links.example.org", "POST", "/api/e"));
    expect(beacon.headers.get("x-middleware-next")).toBe("1");
    expect(resolveCustomDomain).toHaveBeenCalledTimes(1);
  });

  it("an invalid label under the root is the tenant route's 405 for a POST too", async () => {
    const response = await proxy(methodRequest("ab.localhost:3000", "POST"));
    expect(response.status).toBe(405);
    expect(response.headers.get("content-security-policy")).toBe(TENANT_PAGE_CSP);
  });
});
