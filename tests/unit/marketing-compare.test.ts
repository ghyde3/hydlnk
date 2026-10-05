import { describe, expect, it } from "vitest";
import {
  CHECKED_ON,
  COMPETITORS,
  SOURCES,
  allClaims,
  claimFor,
} from "@/components/marketing/compare/data";
import { COMPARE_PATHS, FOOTER_COLUMNS, SITEMAP_PATHS } from "@/components/marketing/site-map";

describe("comparison page data (M11-02, M11-03)", () => {
  it("gives every claim a source URL, a known source and a checked date", () => {
    const claims = allClaims();
    expect(claims.length).toBeGreaterThan(15);
    for (const item of claims) {
      expect(item.text.length, item.text).toBeGreaterThan(20);
      expect(item.sources.length, item.text).toBeGreaterThan(0);
      for (const id of item.sources) {
        expect(SOURCES[id], `${id} in "${item.text}"`).toBeDefined();
        expect(SOURCES[id].url).toMatch(/^https:\/\/[a-z.]+\//);
      }
      expect(item.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(item.checked).toBe(CHECKED_ON);
    }
  });

  it("covers the five table topics for every competitor", () => {
    for (const competitor of COMPETITORS) {
      for (const topic of ["price", "domain", "badge", "design", "fees"] as const) {
        expect(claimFor(competitor, topic).text).not.toBe("");
      }
      expect(competitor.trademarkLine).toContain("not affiliated");
    }
  });

  it("keeps slugs unique and puts every page in the sitemap", () => {
    expect(new Set(COMPETITORS.map((c) => c.slug)).size).toBe(COMPETITORS.length);
    expect(new Set(COMPETITORS.map((c) => c.title)).size).toBe(COMPETITORS.length);
    expect([...COMPARE_PATHS].sort()).toEqual(
      [
        "/vs/linktree",
        "/vs/beacons",
        "/linktree-custom-domain",
        "/remove-linktree-badge",
        "/link-in-bio/shopify",
      ].sort(),
    );
    for (const path of COMPARE_PATHS) expect(SITEMAP_PATHS).toContain(path);
  });

  it("links both comparisons from the footer", () => {
    const hrefs = FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => link.href));
    expect(hrefs).toContain("/vs/linktree");
    expect(hrefs).toContain("/vs/beacons");
  });
});
