import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GUIDES, SITEMAP_PATHS, guideHref } from "@/components/marketing/site-map";

vi.mock("@/lib/env/client", () => ({
  clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" },
}));

const { GUIDE_BODIES } = await import("@/components/marketing/guides");

/** M13-01: the four registrar guides. */
const SLUGS = [
  "connect-a-domain-godaddy",
  "connect-a-domain-namecheap",
  "connect-a-domain-squarespace",
  "connect-a-domain-cloudflare",
];

const html = (slug: string) =>
  renderToStaticMarkup(createElement("div", null, GUIDE_BODIES[slug]!.content));

describe("registrar guides (M13-01)", () => {
  it("sit right after connecting-a-domain in GUIDES and in the sitemap", () => {
    const slugs = GUIDES.map((guide) => guide.slug);
    const at = slugs.indexOf("connecting-a-domain");
    expect(slugs.slice(at + 1, at + 5)).toEqual(SLUGS);
    for (const slug of SLUGS) expect(SITEMAP_PATHS).toContain(guideHref(slug));
  });

  it.each(SLUGS)("%s has a body, five sections, sources and the check date", (slug) => {
    expect(GUIDE_BODIES[slug]).toBeDefined();
    expect(GUIDE_BODIES[slug]!.toc).toHaveLength(5);
    const out = html(slug);
    expect(out).toContain("Checked October 2026");
    const sources = [...out.matchAll(/<a href="(https:\/\/[^"]+)" rel="nofollow noopener"/g)];
    expect(sources.length).toBeGreaterThanOrEqual(1);
    for (const section of GUIDE_BODIES[slug]!.toc) expect(out).toContain(`id="${section[0]}"`);
  });

  it.each(SLUGS)("%s hard-codes no address and never names the host", (slug) => {
    const out = html(slug);
    expect(out).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(out).not.toMatch(/vercel/i);
    expect(out).toContain("letsencrypt.org");
    expect(out).toContain("AAAA");
  });

  it("is linked from connecting-a-domain", () => {
    const out = html("connecting-a-domain");
    expect(out).toContain("Step by step at your provider");
    for (const slug of SLUGS) expect(out).toContain(`href="${guideHref(slug)}"`);
  });
});
