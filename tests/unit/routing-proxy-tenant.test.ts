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
const { TENANT_CONTENT_SECURITY_POLICY, setTenantHeaders } =
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

describe("M2-22 the CSP of a tenant page", () => {
  it("allows only the nine embed origins (M6-26), no plugins, no <base>, no framing, and has no script-src or nonce", () => {
    expect(TENANT_CONTENT_SECURITY_POLICY).toBe(
      "frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com https://w.soundcloud.com https://embed.music.apple.com https://player.twitch.tv https://clips.twitch.tv; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(TENANT_CONTENT_SECURITY_POLICY).not.toMatch(/script-src|nonce|default-src/);
  });

  it("setTenantHeaders sets the four security headers", () => {
    const headers = new Headers();
    setTenantHeaders(headers);
    expect(headers.get("content-security-policy")).toBe(TENANT_CONTENT_SECURITY_POLICY);
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("M2-22 the proxy puts those headers on tenant and custom-domain responses only", () => {
  it("a handle host is rewritten to /t/<handle> with the headers, for the page and every sub-path", async () => {
    for (const path of ["/", "/x", "/og"]) {
      const response = await proxy(request("mara.localhost:3000", path));
      const rewrite = response.headers.get("x-middleware-rewrite") ?? "";
      expect(new URL(rewrite).pathname).toBe(path === "/" ? "/t/mara" : `/t/mara${path}`);
      for (const name of TENANT_HEADERS)
        expect(response.headers.get(name), `${path} ${name}`).toBeTruthy();
      expect(response.headers.get("content-security-policy")).toBe(TENANT_CONTENT_SECURITY_POLICY);
    }
  });

  it("a custom domain gets them too, known or not (the unknown-site 404 is a tenant page as well)", async () => {
    resolveCustomDomain.mockResolvedValueOnce("page-1");
    const known = await proxy(request("links.example.org"));
    expect(new URL(known.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/sites/page-1");
    expect(known.headers.get("content-security-policy")).toBe(TENANT_CONTENT_SECURITY_POLICY);

    resolveCustomDomain.mockResolvedValueOnce(null);
    const unknown = await proxy(request("nobody.example.org"));
    expect(new URL(unknown.headers.get("x-middleware-rewrite") ?? "").pathname).toBe(
      "/sites/unknown",
    );
    expect(unknown.headers.get("content-security-policy")).toBe(TENANT_CONTENT_SECURITY_POLICY);
  });

  it("the marketing, www and app hosts do not get the tenant policy", async () => {
    const marketing = await proxy(request("localhost:3000"));
    expect(marketing.headers.get("content-security-policy")).toBeNull();

    const www = await proxy(request("www.localhost:3000"));
    expect(www.status).toBe(308);
    expect(www.headers.get("content-security-policy")).toBeNull();

    const app = await proxy(request("app.localhost:3000", "/editor"));
    expect(app.headers.get("content-security-policy")).not.toBe(TENANT_CONTENT_SECURITY_POLICY);
  });
});
