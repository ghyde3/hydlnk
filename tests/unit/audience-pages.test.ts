import { describe, expect, it } from "vitest";
import {
  AUDIENCES,
  CREATOR_AUDIENCES,
  HUB_FAQ,
  PLATFORM_AUDIENCES,
  audienceBySlug,
  audienceHref,
} from "@/components/marketing/audiences/data";
import { faqPageJsonLd, jsonLdScript } from "@/components/marketing/audiences/json-ld";
import { FOOTER_COLUMNS, GUIDES, SITEMAP_PATHS } from "@/components/marketing/site-map";

/**
 * The link-in-bio landing pages (/link-in-bio and /link-in-bio/<slug>): one data file feeds the
 * pages, the hub, the home strip, the footer and the sitemap. These tests keep that list honest,
 * and enforce Gary's copy rules (2026-10-03) on every string in it: American English, plain words
 * and nothing the product doesn't ship.
 */

const REQUIRED = [
  "tiktok",
  "instagram",
  "youtube",
  "twitch",
  "x",
  "musicians",
  "podcasters",
  "artists",
  "small-business",
  "coaches",
];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) strings(item, out);
  return out;
}

/** Copy only: the preset is sample content for the demo builder, checked by its own tests. */
function copyStrings(): string[] {
  return strings(AUDIENCES.map((audience) => ({ ...audience, preset: undefined }))).concat(
    strings(HUB_FAQ),
  );
}

describe("audience list", () => {
  it("has a page for every platform and creator type the hub promises", () => {
    for (const slug of REQUIRED) expect(audienceBySlug(slug), slug).toBeDefined();
    expect(AUDIENCES.length).toBeGreaterThanOrEqual(10);
    expect(PLATFORM_AUDIENCES.length + CREATOR_AUDIENCES.length).toBe(AUDIENCES.length);
  });

  it("has unique slugs that are valid path segments", () => {
    const slugs = AUDIENCES.map((audience) => audience.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("is in the sitemap, hub first, with no path the app host owns", () => {
    expect(SITEMAP_PATHS).toContain(audienceHref());
    for (const audience of AUDIENCES) expect(SITEMAP_PATHS).toContain(audienceHref(audience.slug));
    expect(new Set(SITEMAP_PATHS).size).toBe(SITEMAP_PATHS.length);
  });

  it("links the platforms and the hub from the footer, and every footer link lands on a real page", () => {
    const column = FOOTER_COLUMNS.find((item) => item.title === "Link in bio for");
    expect(column).toBeDefined();
    const hrefs = column!.links.map((link) => link.href);
    expect(hrefs).toContain(audienceHref());
    for (const audience of PLATFORM_AUDIENCES) expect(hrefs).toContain(audienceHref(audience.slug));
    for (const href of hrefs) expect(SITEMAP_PATHS, href).toContain(href);
  });

  it("only points at pages and guides that exist", () => {
    const guideSlugs = GUIDES.map((guide) => guide.slug);
    for (const audience of AUDIENCES) {
      expect(audience.related.length, audience.slug).toBeGreaterThanOrEqual(2);
      for (const slug of audience.related) {
        expect(slug, `${audience.slug} relates to itself`).not.toBe(audience.slug);
        expect(audienceBySlug(slug), `${audience.slug} -> ${slug}`).toBeDefined();
      }
      for (const slug of audience.guides)
        expect(guideSlugs, `${audience.slug} -> ${slug}`).toContain(slug);
      for (const step of audience.steps) {
        if (step.link) expect(SITEMAP_PATHS, step.link.href).toContain(step.link.href);
      }
    }
  });
});

describe("each page is its own page", () => {
  it("has the pieces the template shows", () => {
    for (const audience of AUDIENCES) {
      expect(audience.h1, audience.slug).toMatch(/^Link in bio for /);
      expect(audience.title, audience.slug).toBe(audience.h1);
      expect(audience.description.length, `${audience.slug} description`).toBeGreaterThanOrEqual(
        70,
      );
      expect(audience.description.length, `${audience.slug} description`).toBeLessThanOrEqual(165);
      expect(audience.steps.length, audience.slug).toBeGreaterThanOrEqual(4);
      expect(audience.fits.length, audience.slug).toBeGreaterThanOrEqual(3);
      expect(audience.starter.length, audience.slug).toBeGreaterThanOrEqual(4);
      expect(audience.faq.length, audience.slug).toBeGreaterThanOrEqual(3);
      expect(audience.preset.blocks?.length, `${audience.slug} preset blocks`).toBeGreaterThan(2);
    }
  });

  it("shares no heading, question, lead or description with another page", () => {
    const seen = new Map<string, string>();
    const claim = (kind: string, text: string, slug: string) => {
      const key = `${kind}:${text.toLowerCase()}`;
      expect(
        seen.get(key),
        `${kind} "${text}" used by ${seen.get(key)} and ${slug}`,
      ).toBeUndefined();
      seen.set(key, slug);
    };
    for (const { slug, lead, description, fits, starter, steps, faq } of AUDIENCES) {
      claim("lead", lead, slug);
      claim("description", description, slug);
      for (const fit of fits) {
        claim("fit title", fit.title, slug);
        claim("fit body", fit.body, slug);
      }
      for (const item of starter) claim("starter body", item.body, slug);
      for (const step of steps) claim("step body", step.body, slug);
      for (const item of faq) claim("question", item.question, slug);
    }
  });

  it("answers the question people actually search on the platform pages", () => {
    for (const audience of PLATFORM_AUDIENCES) {
      expect(audience.stepsTitle, audience.slug).toMatch(
        /^How to (add|put) .*(bio|channel|profile)$/,
      );
    }
  });

  it("builds FAQPage data that parses and cannot close its script element", () => {
    for (const audience of AUDIENCES) {
      const raw = jsonLdScript(faqPageJsonLd(audience.faq));
      expect(raw).not.toContain("<");
      const data = JSON.parse(raw);
      expect(data["@type"]).toBe("FAQPage");
      expect(data.mainEntity).toHaveLength(audience.faq.length);
    }
    expect(JSON.parse(jsonLdScript(faqPageJsonLd(HUB_FAQ))).mainEntity).toHaveLength(
      HUB_FAQ.length,
    );
  });
});

describe("copy rules", () => {
  const all = copyStrings();

  it("has copy to check", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("is American English", () => {
    const british =
      /colour|favour|customis|organis|recognis|personalis|optimis|\bcentre|cancelled|labelled|travelling|\bgrey\b|analyse|behaviour|neighbour|licence|catalogue|whilst|\bmum\b|programme/i;
    expect(all.filter((text) => british.test(text))).toEqual([]);
  });

  it("uses plain words, not the product's insides", () => {
    const jargon =
      /\btokens?\b|schema|\brender|\bCSS\b|\bRLS\b|\bAPI\b|\bSSR\b|\bJSON\b|\bDNS\b|renderer|database|hydrat/i;
    expect(all.filter((text) => jargon.test(text))).toEqual([]);
  });

  it("has no exclamation marks, em dashes or hype", () => {
    expect(all.filter((text) => /!/.test(text))).toEqual([]);
    expect(all.filter((text) => /—/.test(text))).toEqual([]);
    const hype =
      /amazing|powerful|seamless|revolutionary|game-?chang|supercharge|unlock|effortless|stunning|ultimate|best-in-class|cutting-edge|10x/i;
    expect(all.filter((text) => hype.test(text))).toEqual([]);
  });

  it("promises nothing HYDLNK doesn't ship", () => {
    // Scheduled links are not in v1 (site.spec.ts checks the same words on the other pages), and
    // dollar amounts live in src/lib/marketing/prices.ts only.
    expect(
      all.filter((text) => /schedul|csv|invite editors|team access|custom css/i.test(text)),
    ).toEqual([]);
    expect(all.filter((text) => /\$\s?\d/.test(text))).toEqual([]);
    // Embeds are YouTube, Spotify, Vimeo, TikTok, Instagram, SoundCloud, Apple Music and Twitch
    // (not Bandcamp or Apple Podcasts), and there is no gallery or booking tool.
    expect(
      all.filter((text) => /embed(s|ded)? (your |a |the )?(bandcamp|apple podcasts)/i.test(text)),
    ).toEqual([]);
    expect(
      all.filter(
        (text) =>
          /image grid|photo grid|gallery block/i.test(text) &&
          !/no gallery|Is there a gallery/i.test(text),
      ),
    ).toEqual([]);
  });
});
