import { describe, expect, it } from "vitest";
import { FOOTER_COLUMNS, GUIDES, MAIN_NAV, SITEMAP_PATHS, guideHref } from "@/components/marketing/site-map";
import { robotsTxt, sitemapXml } from "@/lib/marketing/seo";

/**
 * robots.txt and sitemap.xml answer every host (the proxy skips both paths), so what they say
 * depends on the Host header. The marketing sitemap must never be served as a tenant's own.
 */
describe.each([
  ["localhost:3000", "http://localhost:3000"],
  ["hydlnk.com", "https://hydlnk.com"],
])("robots.txt and sitemap.xml with root %s", (root, origin) => {
  const host = (prefix: string | null) => (prefix ? `${prefix}.${root}` : root);

  it("marketing host: allows crawling and names the root sitemap", () => {
    const robots = robotsTxt(host(null), root);
    expect(robots.status).toBe(200);
    expect(robots.contentType).toMatch(/^text\/plain/);
    expect(robots.body).toContain("User-agent: *\nAllow: /");
    expect(robots.body).toContain(`Sitemap: ${origin}/sitemap.xml`);
  });

  it("marketing host: the sitemap lists every marketing page, absolute, once", () => {
    const sitemap = sitemapXml(host(null), root);
    expect(sitemap.status).toBe(200);
    expect(sitemap.contentType).toMatch(/^application\/xml/);
    const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual(SITEMAP_PATHS.map((path) => `${origin}${path}`));
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("app host: disallows everything and has no sitemap", () => {
    expect(robotsTxt(host("app"), root).body).toBe("User-agent: *\nDisallow: /\n");
    expect(sitemapXml(host("app"), root).status).toBe(404);
  });

  it.each([["fennmoor"], ["wren-haven"]])("tenant host %s: allows its page, never the marketing sitemap", (handle) => {
    const robots = robotsTxt(host(handle), root);
    expect(robots.body).toContain("Allow: /");
    expect(robots.body).toContain("Disallow: /r/");
    expect(robots.body).not.toContain("Sitemap:");
    const sitemap = sitemapXml(host(handle), root);
    expect(sitemap.status).toBe(404);
    expect(sitemap.body).not.toContain("<urlset");
  });

  it("custom domain: same as a tenant host", () => {
    expect(robotsTxt("links.example.org", root).body).not.toContain("Sitemap:");
    expect(sitemapXml("links.example.org", root).status).toBe(404);
  });
});

describe("marketing site map", () => {
  it("puts every header page, every guide and both legal pages in the sitemap", () => {
    for (const item of MAIN_NAV) expect(SITEMAP_PATHS).toContain(item.href);
    for (const guide of GUIDES) expect(SITEMAP_PATHS).toContain(guideHref(guide.slug));
    for (const path of ["/", "/faq", "/privacy", "/terms"]) expect(SITEMAP_PATHS).toContain(path);
  });

  it("links Privacy and Terms from the footer", () => {
    const hrefs = FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => link.href));
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/terms");
  });

  it("has unique guide slugs that are valid path segments", () => {
    const slugs = GUIDES.map((guide) => guide.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
