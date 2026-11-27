import { readFileSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TERM_SLUG_PATTERN,
  archiveInternalSuffix,
  archiveRoute,
  archiveRouteFromParams,
  type ArchiveRoute,
} from "@/lib/routing/archive-paths";
import { PLAIN_404_PATH, siteRewritePath, tenantRewritePath } from "@/lib/routing/paths";
import { RESERVED_ENTRY_SLUGS, RESERVED_PATHS } from "@/lib/document/path";

/**
 * M16-03: the deeper paths of a site's host are a fixed set of shapes under an archive, decided
 * with no lookup; each goes to its own explicit dynamic route and every other deeper path is the
 * one plain 404 with no query string.
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
const LONG_TERM = "t".repeat(80);

const VALID: Array<[string, ArchiveRoute, string]> = [
  ["/blog/my-post", { kind: "post", archive: "blog", slug: "my-post" }, "/a/blog/e/my-post"],
  ["/blog/a", { kind: "post", archive: "blog", slug: "a" }, "/a/blog/e/a"],
  ["/news-2/x9", { kind: "post", archive: "news-2", slug: "x9" }, "/a/news-2/e/x9"],
  ["/blog/page/2", { kind: "paged", archive: "blog", page: 2 }, "/a/blog/n/2"],
  ["/blog/page/10", { kind: "paged", archive: "blog", page: 10 }, "/a/blog/n/10"],
  ["/blog/page/9999", { kind: "paged", archive: "blog", page: 9999 }, "/a/blog/n/9999"],
  [
    "/blog/category/news",
    { kind: "term", archive: "blog", taxonomy: "category", term: "news", page: 1 },
    "/a/blog/x/category/news/1",
  ],
  [
    "/blog/tag/news",
    { kind: "term", archive: "blog", taxonomy: "tag", term: "news", page: 1 },
    "/a/blog/x/tag/news/1",
  ],
  [
    `/blog/tag/${LONG_TERM}`,
    { kind: "term", archive: "blog", taxonomy: "tag", term: LONG_TERM, page: 1 },
    `/a/blog/x/tag/${LONG_TERM}/1`,
  ],
  [
    "/blog/category/news/page/2",
    { kind: "term", archive: "blog", taxonomy: "category", term: "news", page: 2 },
    "/a/blog/x/category/news/2",
  ],
  [
    "/blog/tag/page/page/45",
    { kind: "term", archive: "blog", taxonomy: "tag", term: "page", page: 45 },
    "/a/blog/x/tag/page/45",
  ],
  ["/blog/feed.xml", { kind: "feed", archive: "blog" }, "/a/blog/feed"],
];

const REFUSED = [
  "",
  "/",
  "blog/my-post",
  "/blog",
  "/blog/",
  "/blog/my-post/",
  "//blog/my-post",
  "/blog//my-post",
  // Uppercase, dots, encodings, spaces.
  "/Blog/my-post",
  "/blog/My-Post",
  "/blog/my.post",
  "/blog/my_post",
  "/blog/my%2fpost",
  "/blog/my post",
  "/blog/ü",
  "/blog/-x",
  "/blog/x-",
  `/blog/${"a".repeat(41)}`,
  // Page numbers: page 1 is the archive itself; no zero, no leading zero, no exponent, no sign.
  "/blog/page",
  "/blog/page/",
  "/blog/page/1",
  "/blog/page/01",
  "/blog/page/0",
  "/blog/page/2e0",
  "/blog/page/+2",
  "/blog/page/-2",
  "/blog/page/2.0",
  "/blog/page/10000",
  "/blog/page/two",
  "/blog/page/2/",
  "/blog/page/2/x",
  // Terms.
  "/blog/category",
  "/blog/tag",
  "/blog/category/",
  "/blog/category/News",
  "/blog/category/a.b",
  `/blog/tag/${"t".repeat(81)}`,
  "/blog/category/news/",
  "/blog/category/news/page",
  "/blog/category/news/page/1",
  "/blog/category/news/page/01",
  "/blog/category/news/page/0",
  "/blog/category/news/2",
  "/blog/category/news/pages/2",
  "/blog/topic/news",
  "/blog/category/news/page/2/x",
  // Four segments are no shape; neither are six.
  "/blog/a/b/c",
  "/blog/category/news/page/2/3",
  // The feed is one exact name.
  "/blog/feed.XML",
  "/blog/feed.xml/",
  "/blog/feed.xml/x",
  "/blog/rss.xml",
  "/blog/category/news/feed.xml",
  // A long path is never parsed.
  `/blog/${"a/".repeat(300)}`,
];

describe("archiveRoute: exactly the fixed shapes", () => {
  it.each(VALID)("%s", (path, route, suffix) => {
    expect(archiveRoute(path)).toEqual(route);
    expect(archiveInternalSuffix(route)).toBe(suffix);
  });

  it.each(REFUSED)("refuses %j", (path) => {
    expect(archiveRoute(path)).toBeNull();
  });

  it("refuses every reserved first segment, with every tail", () => {
    for (const first of [...RESERVED_PATHS, "hl-query-count", "hl-x"]) {
      for (const tail of ["x", "page/2", "category/news", "tag/news/page/2", "feed.xml"]) {
        expect(archiveRoute(`/${first}/${tail}`), `${first}/${tail}`).toBeNull();
      }
    }
  });

  it("refuses a reserved word as a post slug (the archive words and the reserved paths)", () => {
    for (const slug of [...RESERVED_ENTRY_SLUGS, ...RESERVED_PATHS, "hl-x"]) {
      if (slug === "feed.xml") continue; // the feed's own shape
      expect(archiveRoute(`/blog/${slug}`), slug).toBeNull();
    }
  });

  it("the term slug rule is the writer's, character for character", () => {
    const source = readFileSync("src/lib/content/terms-core.ts", "utf8");
    const writers = /const SLUG = (\/.+\/);/.exec(source)?.[1];
    expect(writers).toBe(String(TERM_SLUG_PATTERN));
    const hrefs = readFileSync("src/lib/blog/types.ts", "utf8");
    expect(/const TERM_SLUG = (\/.+\/);/.exec(hrefs)?.[1]).toBe(String(TERM_SLUG_PATTERN));
  });
});

describe("archiveRouteFromParams: a route handler parses its own params again", () => {
  it("gives back the route of each shape", () => {
    expect(archiveRouteFromParams({ archive: "blog", slug: "my-post" })).toEqual(VALID[0]![1]);
    expect(archiveRouteFromParams({ archive: "blog", n: "2" })).toEqual(VALID[3]![1]);
    expect(
      archiveRouteFromParams({ archive: "blog", taxonomy: "category", term: "news", n: "1" }),
    ).toEqual(VALID[6]![1]);
    expect(
      archiveRouteFromParams({ archive: "blog", taxonomy: "category", term: "news", n: "2" }),
    ).toEqual(VALID[9]![1]);
    expect(archiveRouteFromParams({ archive: "blog", feed: true })).toEqual({
      kind: "feed",
      archive: "blog",
    });
  });

  it("refuses params that would only parse as another shape, or as nothing", () => {
    for (const params of [
      { archive: "blog", slug: "feed.xml" },
      { archive: "blog", slug: "page/2" },
      { archive: "blog", slug: "category/news" },
      { archive: "blog", slug: "My-Post" },
      { archive: "blog/x", slug: "y" },
      { archive: "og", slug: "y" },
      { archive: "blog", n: "1" },
      { archive: "blog", n: "01" },
      { archive: "blog", n: "2e0" },
      { archive: "blog", n: "0" },
      { archive: "blog", n: "10000" },
      { archive: "blog", taxonomy: "topic", term: "news", n: "1" },
      { archive: "blog", taxonomy: "category", term: "news/page/3", n: "1" },
      { archive: "blog", taxonomy: "category", term: "News", n: "1" },
      { archive: "blog", taxonomy: "category", term: "news", n: "01" },
      { archive: "blog", taxonomy: "category", term: "news", n: "0" },
      { archive: "blog", taxonomy: "category", n: "1" },
      { archive: "blog" },
      { archive: "Blog", feed: true as const },
    ]) {
      expect(archiveRouteFromParams(params), JSON.stringify(params)).toBeNull();
    }
  });
});

describe("the rewrite functions", () => {
  it.each(VALID)(
    "%s goes to its explicit route on a handle host and a custom host",
    (path, _r, suffix) => {
      expect(tenantRewritePath("mara", path)).toBe(`/t/mara${suffix}`);
      expect(siteRewritePath(PAGE, path)).toBe(`/sites/${PAGE}${suffix}`);
      expect(siteRewritePath("unknown", path)).toBe(PLAIN_404_PATH);
    },
  );

  it("every other path of two or more segments is the one plain 404", () => {
    for (const path of REFUSED.filter((candidate) => candidate.split("/").length > 2)) {
      if (path === "/blog/") continue; // `/blog/` is two parts with an empty one: also the 404
      expect(tenantRewritePath("mara", path), path).toBe(PLAIN_404_PATH);
      expect(siteRewritePath(PAGE, path), path).toBe(PLAIN_404_PATH);
    }
    expect(tenantRewritePath("mara", "/blog/")).toBe(PLAIN_404_PATH);
  });
});

describe("the proxy", () => {
  const request = (host: string, path: string, method = "GET") =>
    new NextRequest(`http://${host}${path}`, { method, headers: { host } });
  const target = (response: Response) => response.headers.get("x-middleware-rewrite");

  beforeEach(() => {
    resolveCustomDomain.mockReset();
    resolveCustomDomain.mockResolvedValue(PAGE);
  });

  it.each(VALID)(
    "%s is rewritten on both hosts, with the tenant headers and no cookie",
    async (path, _r, suffix) => {
      const onHandle = await proxy(request("mara.localhost:3000", path));
      expect(target(onHandle)).toBe(`http://mara.localhost:3000/t/mara${suffix}`);
      const onCustom = await proxy(request("links.example.org", path));
      expect(target(onCustom)).toBe(`http://links.example.org/sites/${PAGE}${suffix}`);
      for (const response of [onHandle, onCustom]) {
        expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.has("set-cookie")).toBe(false);
      }
    },
  );

  it("a deeper path of no shape is the one 404 URL, with no query string", async () => {
    const urls = new Set<string | null>();
    for (const path of [
      "/blog/page/1?x=1",
      "/blog/page/2e0",
      "/blog/a/b/c?utm=1",
      "/blog/My-Post",
      "/blog/category/news/page/01",
      "/og/x",
      "/t/mara/a/blog/e/x",
      "/sites/x/a/blog/feed",
    ]) {
      urls.add(target(await proxy(request("mara.localhost:3000", path))));
    }
    expect([...urls]).toEqual(["http://mara.localhost:3000/sites/unknown"]);
  });

  it("an encoded slash never makes a shape: `%2F` stays inside its segment and is refused", async () => {
    for (const path of ["/blog/a%2Fb", "/blog%2Fmy-post", "/blog/category%2Fnews"]) {
      const response = await proxy(request("mara.localhost:3000", path));
      const rewritten = new URL(target(response) ?? "http://x/").pathname;
      expect(
        ["/sites/unknown", "/t/mara/p/blog"].includes(rewritten),
        `${path} -> ${rewritten}`,
      ).toBe(true);
      expect(rewritten.startsWith("/t/mara/a/"), path).toBe(false);
    }
  });

  it("a POST, PUT or DELETE to any archive path is the plain 404, never a route", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      for (const [path] of VALID) {
        for (const host of ["mara.localhost:3000", "links.example.org"]) {
          const response = await proxy(request(host, path, method));
          expect(response.status, `${method} ${host}${path}`).toBe(404);
          expect(target(response), `${method} ${host}${path}`).toBeNull();
          expect(response.headers.get("x-middleware-next")).toBeNull();
          expect(response.headers.get("cache-control")).toBe("no-store");
        }
      }
    }
  });

  it("the marketing and app hosts never reach an archive route", async () => {
    for (const path of ["/blog/my-post", "/blog/feed.xml", "/blog/page/2"]) {
      const marketing = target(await proxy(request("localhost:3000", path)));
      expect(marketing ?? "", path).not.toMatch(/\/(t|sites)\//);
      const app = target(await proxy(request("app.localhost:3000", path)));
      expect(app ?? "", path).not.toMatch(/\/(t|sites)\//);
    }
  });
});
