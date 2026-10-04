import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { siteRewritePath, tenantRewritePath, PLAIN_404_PATH } from "@/lib/routing/paths";
import { TENANT_CONTENT_SECURITY_POLICY } from "@/lib/routing/tenant-headers";

/**
 * Wave J security review, medium: a sub-path on a tenant or custom host must not create a cache
 * entry of its own. Both `[...rest]` route handlers were force-static with `dynamicParams`, so every
 * distinct path an attacker invented was generated once and stored for 24 hours. Now the proxy sends
 * every path that is not the page, its image or a test hook to ONE internal path (the plain tenant
 * 404 that an unknown custom host already used), so the whole supply of invented paths shares a
 * single cache entry, and the two `[...rest]` routes are gone.
 */

vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));
vi.mock("@/lib/routing/session", () => ({
  rewriteWithSession: vi.fn(async (_request: NextRequest, url: URL) => NextResponse.rewrite(url)),
}));
const resolveCustomDomain = vi.fn<(host: string) => Promise<string | null>>();
vi.mock("@/lib/routing/custom-domain", () => ({ resolveCustomDomain }));

const { proxy } = await import("@/proxy");

const PAGE = "11111111-1111-4111-8111-111111111111";

const request = (host: string, path = "/", method = "GET") =>
  new NextRequest(`http://${host}${path}`, { method, headers: { host } });
const rewriteOf = (response: Response) => {
  const value = response.headers.get("x-middleware-rewrite");
  return value ? new URL(value).pathname : null;
};

/** What an attacker (or a crawler) might ask for, plus a lot of invented paths. */
const randomPath = (i: number) =>
  `/${Math.random().toString(36).slice(2)}${i}${i % 3 === 0 ? `/${Math.random().toString(36).slice(2)}` : ""}`;
const SPECIAL_PATHS = [
  "/anything",
  "/a/b/c",
  "/login",
  "/editor",
  "/OG",
  "/og/",
  "/og/extra",
  "/og.png",
  "/hl-query-count",
  "/hl-fail-next-read",
  "/t/other",
  "/t/mara/og",
  "/sites/22222222-2222-4222-8222-222222222222",
  "/app/api/domains/0b0e1f2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b.png",
  "/api/stripe/webhook",
  "/api/e/extra",
  "/r",
  "/rr/x",
  "//double",
  "/%2e%2e/x",
  "/with space",
  "/ü",
];
const INVENTED = [...SPECIAL_PATHS, ...Array.from({ length: 60 }, (_, i) => randomPath(i))];

beforeEach(() => {
  resolveCustomDomain.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the pure rewrite paths", () => {
  it("PLAIN_404_PATH is the unknown-site path the proxy already used", () => {
    expect(PLAIN_404_PATH).toBe("/sites/unknown");
  });

  it("tenantRewritePath: the page and its image keep their own path, everything else is the one 404", () => {
    expect(tenantRewritePath("mara", "/")).toBe("/t/mara");
    expect(tenantRewritePath("mara", "")).toBe("/t/mara");
    expect(tenantRewritePath("mara", "/og")).toBe("/t/mara/og");
    for (const path of INVENTED) expect(tenantRewritePath("mara", path), path).toBe(PLAIN_404_PATH);
  });

  it("tenantRewritePath: the test hooks only exist when asked for", () => {
    for (const path of ["/hl-query-count", "/hl-fail-next-read"]) {
      expect(tenantRewritePath("mara", path)).toBe(PLAIN_404_PATH);
      expect(tenantRewritePath("mara", path, true)).toBe(`/t/mara${path}`);
    }
    // Asking for the hooks never opens a path that is not a hook.
    expect(tenantRewritePath("mara", "/anything", true)).toBe(PLAIN_404_PATH);
    expect(tenantRewritePath("mara", "/hl-query-count/x", true)).toBe(PLAIN_404_PATH);
  });

  it("siteRewritePath: the page and its image keep their own path, everything else (and the unknown id) is the one 404", () => {
    expect(siteRewritePath(PAGE, "/")).toBe(`/sites/${PAGE}`);
    expect(siteRewritePath(PAGE, "/og")).toBe(`/sites/${PAGE}/og`);
    for (const path of INVENTED) expect(siteRewritePath(PAGE, path), path).toBe(PLAIN_404_PATH);
    for (const path of ["/", "/og", ...INVENTED.slice(0, 5)]) {
      expect(siteRewritePath("unknown", path), path).toBe(PLAIN_404_PATH);
    }
  });
});

describe("a handle host: invented paths share one cache entry", () => {
  it("every path that is not the page or /og is rewritten to the same internal path, with the tenant headers", async () => {
    const targets = new Set<string | null>();
    for (const path of INVENTED) {
      const response = await proxy(request("mara.localhost:3000", path));
      targets.add(rewriteOf(response));
      expect(rewriteOf(response), path).toBe(PLAIN_404_PATH);
      expect(response.headers.get("content-security-policy"), path).toBeTruthy();
      expect(response.headers.has("set-cookie"), path).toBe(false);
    }
    expect([...targets]).toEqual([PLAIN_404_PATH]);
  });

  it("the page, /og and a query string keep going to the handle", async () => {
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/")))).toBe("/t/mara");
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/og")))).toBe("/t/mara/og");
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/?x=1&y=2")))).toBe("/t/mara");
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/og?v=123")))).toBe("/t/mara/og");
  });

  it("the 404 target is one URL: no query string and no trailing slash ever ride along", async () => {
    const urls = new Set<string>();
    for (const path of ["/x?a=1", "/y?utm=zzz&b=2", "/z/", "/deep/er/path?q=1"]) {
      const response = await proxy(request("mara.localhost:3000", path));
      urls.add(response.headers.get("x-middleware-rewrite") ?? "");
    }
    expect([...urls]).toEqual(["http://mara.localhost:3000/sites/unknown"]);
    // The page itself still keeps its query string (nothing reads it; it is the visitor's own URL).
    const page = await proxy(request("mara.localhost:3000", "/?utm=1"));
    expect(page.headers.get("x-middleware-rewrite")).toBe(
      "http://mara.localhost:3000/t/mara?utm=1",
    );
  });

  it("HEAD is treated like GET", async () => {
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/x", "HEAD")))).toBe(
      PLAIN_404_PATH,
    );
    expect(rewriteOf(await proxy(request("mara.localhost:3000", "/", "HEAD")))).toBe("/t/mara");
  });

  it("the tracking routes are still passed through, not rewritten", async () => {
    const click = await proxy(request("mara.localhost:3000", "/r/page/block"));
    expect(click.headers.get("x-middleware-next")).toBe("1");
    expect(rewriteOf(click)).toBeNull();
    const beacon = await proxy(request("mara.localhost:3000", "/api/e", "POST"));
    expect(beacon.headers.get("x-middleware-next")).toBe("1");
  });

  it("the test hooks are reachable only with the flag on, and never in production", async () => {
    for (const path of ["/hl-query-count", "/hl-fail-next-read"]) {
      vi.stubEnv("HYDLNK_QUERY_COUNTER", "");
      expect(rewriteOf(await proxy(request("mara.localhost:3000", path))), `off ${path}`).toBe(
        PLAIN_404_PATH,
      );
      vi.stubEnv("HYDLNK_QUERY_COUNTER", "1");
      expect(rewriteOf(await proxy(request("mara.localhost:3000", path))), `on ${path}`).toBe(
        `/t/mara${path}`,
      );
      vi.stubEnv("VERCEL_ENV", "production");
      expect(rewriteOf(await proxy(request("mara.localhost:3000", path))), `prod ${path}`).toBe(
        PLAIN_404_PATH,
      );
      vi.stubEnv("VERCEL_ENV", "preview");
      expect(rewriteOf(await proxy(request("mara.localhost:3000", path))), `preview ${path}`).toBe(
        `/t/mara${path}`,
      );
      vi.unstubAllEnvs();
    }
  });

  it("an address that is not a handle ('ab') sends its sub-paths to the same one 404", async () => {
    expect(rewriteOf(await proxy(request("ab.localhost:3000", "/")))).toBe("/t/ab");
    for (const path of INVENTED) {
      expect(rewriteOf(await proxy(request("ab.localhost:3000", path))), path).toBe(PLAIN_404_PATH);
    }
  });
});

describe("a custom host: invented paths share the same one cache entry", () => {
  it("a resolved host: the page and /og go to its page, every other path to the one 404", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    expect(rewriteOf(await proxy(request("links.example.org", "/")))).toBe(`/sites/${PAGE}`);
    expect(rewriteOf(await proxy(request("links.example.org", "/og")))).toBe(`/sites/${PAGE}/og`);
    const targets = new Set<string | null>();
    for (const path of INVENTED) {
      const response = await proxy(request("links.example.org", path));
      targets.add(rewriteOf(response));
      expect(response.headers.get("content-security-policy"), path).toBeTruthy();
      expect(response.headers.has("set-cookie"), path).toBe(false);
    }
    expect([...targets]).toEqual([PLAIN_404_PATH]);
  });

  it("an unresolved host (unknown, pending, lookup error) is the one 404 whatever the path, '/og' and '/' included", async () => {
    resolveCustomDomain.mockResolvedValue(null);
    for (const path of ["/", "/og", ...INVENTED]) {
      expect(rewriteOf(await proxy(request("nobody.example.org", path))), path).toBe(
        PLAIN_404_PATH,
      );
    }
    resolveCustomDomain.mockRejectedValue(new Error("database down"));
    for (const path of ["/", "/og", "/x"]) {
      expect(rewriteOf(await proxy(request("links.example.org", path))), path).toBe(PLAIN_404_PATH);
    }
  });

  it("the tracking routes of a resolved host still pass through; an unresolved host gets the one 404", async () => {
    resolveCustomDomain.mockResolvedValue(PAGE);
    const passed = await proxy(request("links.example.org", "/r/a/b"));
    expect(passed.headers.get("x-middleware-next")).toBe("1");
    resolveCustomDomain.mockResolvedValue(null);
    expect(rewriteOf(await proxy(request("nobody.example.org", "/r/a/b")))).toBe(PLAIN_404_PATH);
    // A POST is no page either: it reaches the same static route, which has no POST handler (an error, never a page).
    expect(rewriteOf(await proxy(request("nobody.example.org", "/api/e", "POST")))).toBe(
      PLAIN_404_PATH,
    );
  });

  it("carries the same tenant policy as every other tenant response", async () => {
    resolveCustomDomain.mockResolvedValue(null);
    const response = await proxy(request("nobody.example.org", "/anything"));
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(TENANT_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });
});

describe("the catch-all routes are gone", () => {
  const tenantRoot = join(process.cwd(), "src/app/(tenant)");

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
    });
  }

  it("neither /t/[handle]/[...rest] nor /sites/[pageId]/[...rest] exists", () => {
    expect(existsSync(join(tenantRoot, "t/[handle]/[...rest]"))).toBe(false);
    expect(existsSync(join(tenantRoot, "sites/[pageId]/[...rest]"))).toBe(false);
  });

  it("no route under (tenant) has a catch-all or optional catch-all segment", () => {
    const catchAll = walk(tenantRoot).filter((path) => /\[\[?\.\.\./.test(path));
    expect(catchAll).toEqual([]);
  });

  it("the only dynamic segments are the handle and the page id, so the static routes are keyed by them alone", () => {
    const dynamic = new Set(
      walk(tenantRoot)
        .flatMap((path) => path.match(/\[[^\]]+\]/g) ?? [])
        .map((segment) => segment),
    );
    expect([...dynamic].sort()).toEqual(["[handle]", "[pageId]"]);
  });
});
