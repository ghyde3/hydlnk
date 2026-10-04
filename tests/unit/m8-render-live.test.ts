// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import type { PublishDoc } from "@/lib/document";
import { pageChrome } from "@/lib/publish/chrome";
import { pageMetadata } from "@/lib/publish/share-meta";
import { PAGE_ID, PARITY_DOCS, waveGPublished } from "./fixtures/m8-render-docs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/page-media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

const { renderLivePage, livePageBody } = await import("@/lib/tenant-render/live-page");
const { TENANT_SCRIPT_SRC, tenantFontPreloads } = await import("@/lib/tenant-assets");

/**
 * M8-02: the published page as finished HTML. Built by the live builder from the very same
 * PageRenderer the editor preview draws: no framework markers, one `<style>`, one deferred
 * same-origin `<script>`, the head tags the page always had, every value escaped.
 */

const URLS = {
  page: "http://mara.localhost:3000/",
  image: "http://mara.localhost:3000/og?v=1791079959447",
};

const live = (doc = waveGPublished, plan = "free") =>
  renderLivePage({ pageId: PAGE_ID, document: doc, plan, urls: URLS });
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("M8-02 the document is finished HTML, with no framework in it", () => {
  const html = live();

  it("starts with the doctype and <html lang=en>, a charset and a viewport", () => {
    expect(html.startsWith('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">')).toBe(true);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
  });

  it.each([
    "__next_f",
    "__NEXT_DATA__",
    "$RC",
    "<template data-dgst",
    "/_next/",
    "modulepreload",
    "<!--$-->",
    "<!--/$-->",
    "data-reactroot",
    "<!-- -->",
  ])("contains no %s", (marker) => {
    expect(html).not.toContain(marker);
  });

  it("has no stylesheet link: its CSS is one <style> element in <head>", () => {
    const doc = parse(html);
    expect(doc.querySelectorAll('link[rel="stylesheet"]').length).toBe(0);
    expect(doc.head.querySelectorAll("style").length).toBe(1);
    expect(doc.body.querySelectorAll("style").length).toBe(0);
  });

  it("has exactly one <script>: external, deferred, same-origin, carrying the page id; no inline script", () => {
    const doc = parse(html);
    const scripts = [...doc.querySelectorAll("script")];
    expect(scripts.length).toBe(1);
    const script = scripts[0]!;
    expect(script.getAttribute("src")).toBe(TENANT_SCRIPT_SRC);
    expect(script.getAttribute("src")).toMatch(/^\/_t\/p\.[0-9a-f]{12}\.js$/);
    expect(script.hasAttribute("defer")).toBe(true);
    expect(script.getAttribute("data-page-id")).toBe(PAGE_ID);
    expect(script.textContent).toBe("");
    expect(html.match(/<script/g)?.length).toBe(1);
  });

  it("the body is the renderer's [data-page-root] and the one script, nothing else", () => {
    const doc = parse(html);
    const children = [...doc.body.children].map((child) => child.tagName.toLowerCase());
    expect(children).toEqual(["div", "script"]);
    expect(doc.body.firstElementChild?.hasAttribute("data-page-root")).toBe(true);
  });
});

describe("M8-02 the head carries the tags the page has always had, and only those", () => {
  const doc = parse(live());
  const head = doc.head;

  it("has the title, the description, Open Graph and Twitter tags exactly as pageMetadata returns them", () => {
    const metadata = pageMetadata(waveGPublished, URLS);
    expect(head.querySelector("title")?.textContent).toBe(metadata.title);
    expect(head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      metadata.description,
    );
    const og = (property: string) =>
      head.querySelector(`meta[property="${property}"]`)?.getAttribute("content");
    expect(og("og:title")).toBe("Mara on HYDLNK");
    expect(og("og:description")).toBe("Book a session & see the work");
    expect(og("og:url")).toBe(URLS.page);
    expect(og("og:image")).toBe(URLS.image);
    expect(og("og:image:width")).toBe("1200");
    expect(og("og:image:height")).toBe("630");
    expect(og("og:image:alt")).toBe(waveGPublished.profile.name);
    expect(og("og:type")).toBe("website");
    const tw = (name: string) => head.querySelector(`meta[name="${name}"]`)?.getAttribute("content");
    expect(tw("twitter:card")).toBe("summary_large_image");
    expect(tw("twitter:title")).toBe("Mara on HYDLNK");
    expect(tw("twitter:description")).toBe("Book a session & see the work");
    expect(tw("twitter:image")).toBe(URLS.image);
  });

  it("with no share card, og:title and og:description are the name and the bio", () => {
    const [, nine] = PARITY_DOCS[0]!;
    const plain = parse(live(nine));
    expect(plain.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      nine.profile.name,
    );
    expect(plain.querySelector('meta[property="og:description"]')?.getAttribute("content")).toBe(
      nine.profile.bio,
    );
    expect(plain.querySelector("title")?.textContent).toBe(`${nine.profile.name} - links`);
  });

  it("has the favicon, the font preloads and the avatar preload, and no other element", () => {
    const tags = [...head.children].map((el) => el.tagName.toLowerCase());
    expect(tags.filter((t) => t === "link").length).toBeGreaterThanOrEqual(2);
    const links = [...head.querySelectorAll("link")].map((el) => [
      el.getAttribute("rel"),
      el.getAttribute("as"),
    ]);
    expect(links).toContainEqual(["icon", null]);
    // One preload per font file the page's faces use (none until the font files are vendored).
    const fonts = [...head.querySelectorAll('link[rel="preload"][as="font"]')];
    expect(fonts.map((el) => el.getAttribute("href"))).toEqual(
      tenantFontPreloads(waveGPublished.tokens),
    );
    for (const font of fonts) {
      expect(font.getAttribute("type")).toBe("font/woff2");
      expect(font.hasAttribute("crossorigin")).toBe(true);
      expect(font.getAttribute("href")).toMatch(/^\/_t\/f\//);
    }
    const image = head.querySelector('link[rel="preload"][as="image"]');
    expect(image?.getAttribute("href")).toMatch(/^https:\/\/media\.test\/page-media\//);
    expect(head.querySelectorAll('link[rel="preload"][as="image"]').length).toBe(1);
    const allowed = new Set(["meta", "title", "link", "style"]);
    expect(tags.every((t) => allowed.has(t))).toBe(true);
    expect(head.querySelector("base, script, noscript")).toBeNull();
  });

  it("names no host but the page's own, the media origin and the root: no font host, no preconnect", () => {
    const html = live();
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic|preconnect|dns-prefetch/);
  });
});

describe("M8-02 one serializer escapes every value", () => {
  it("a share title, a name and a bio with markup in them are text, and add no element", () => {
    const hostile = {
      ...waveGPublished,
      profile: {
        ...waveGPublished.profile,
        name: "</title><script>x</script>",
        bio: `a & b < c "quoted" 'single'`,
      },
      share: { title: '"><script>alert(1)</script>', description: "<img src=x onerror=alert(1)>" },
    };
    const html = live(hostile);
    const doc = parse(html);
    expect(doc.querySelectorAll("script").length).toBe(1);
    expect(doc.querySelector("img[onerror]")).toBeNull();
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      '"><script>alert(1)</script>',
    );
    expect(doc.querySelector("title")?.textContent).toBe("</title><script>x</script> - links");
    expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      `a & b < c "quoted" 'single'`,
    );
    // The raw bytes hold no unescaped tenant markup in the head.
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).not.toContain("<script>alert(1)");
    expect(head).not.toContain("</title><script>");
  });
});

describe("M8-02 the style element carries no tenant string", () => {
  it("two pages with the same block types and fonts get byte-identical styles", () => {
    const styleOf = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)![1];
    const a = live(waveGPublished);
    const b = live({
      ...waveGPublished,
      profile: { ...waveGPublished.profile, name: "Someone Else", bio: "Different words" },
      tokens: { ...waveGPublished.tokens, accent: "#00FF00", bg: "#FFFFFF", radius: 2 },
      blocks: waveGPublished.blocks.map((block) =>
        block.type === "link" ? { ...block, label: "X", url: "https://other.example/" } : block,
      ),
    });
    expect(styleOf(a)).toBe(styleOf(b));
  });

  it("a page with only link blocks has no embed, card, grid, social or image rules; a full page has all", () => {
    const [, nine] = PARITY_DOCS[0]!;
    const linksOnly = live({
      ...nine,
      blocks: nine.blocks.filter((block) => block.type === "link"),
    });
    const style = /<style>([\s\S]*?)<\/style>/.exec(linksOnly)![1]!;
    for (const selector of [".pg-embed", ".pg-card", ".pg-grid", ".pg-social", ".pg-image"]) {
      expect(style, selector).not.toContain(selector);
    }
    const full = /<style>([\s\S]*?)<\/style>/.exec(live())![1]!;
    expect(full.length).toBeGreaterThan(style.length);
    for (const type of new Set(waveGPublished.blocks.map((b) => b.type))) {
      expect(full, type).toContain(`pg-${type === "grid" ? "grid" : type}`);
    }
  });
});

describe("M8-02 body parity with the renderer", () => {
  it.each(PARITY_DOCS)("%s: the [data-page-root] subtree equals renderToStaticMarkup(PageRenderer), byte for byte", (_name, doc) => {
    const reference = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc,
        pageId: PAGE_ID,
        mode: "live",
        chrome: pageChrome("free", PAGE_ID),
      }),
    );
    // React writes the avatar's preload hint ahead of the root; the live document moves it to <head>.
    expect(reference.endsWith(livePageBody({ pageId: PAGE_ID, document: doc, plan: "free" }))).toBe(
      true,
    );
    const root = parse(live(doc)).querySelector("[data-page-root]")!.outerHTML;
    expect(root).toBe(parse(`<body>${reference}</body>`).querySelector("[data-page-root]")!.outerHTML);
  });

  it("a hidden block and the draft never appear, and the footer follows the plan", () => {
    const free = live(waveGPublished, "free");
    expect(free).not.toContain("Coming soon");
    expect(free).toContain("Made with HYDLNK");
    expect(free).toContain("Report this page");
    const pro = live(waveGPublished, "pro");
    expect(pro).not.toContain("Made with HYDLNK");
    expect(pro).toContain("Report this page");
  });

  it("a block type this version does not know is skipped and the rest of the page still renders (defense in depth: the schema refuses it at read)", () => {
    const hologram = { id: "hologram-0001", type: "hologram", visible: true } as unknown as PublishDoc["blocks"][number];
    const html = live({ ...waveGPublished, blocks: [hologram, ...waveGPublished.blocks] });
    expect(html).toContain('data-block-id="link-featured-1"');
    expect(html).not.toContain("hologram");
  });

  it("refuses a page id that is not a UUID instead of writing it into an attribute", () => {
    for (const bad of ['"><x', "p1", "", "</script>"]) {
      expect(() =>
        renderLivePage({ pageId: bad, document: waveGPublished, plan: "free", urls: URLS }),
      ).toThrow();
    }
  });
});

describe("M8-02 the head serializer is strict and escapes everything", () => {
  it("escapes the five characters that can end a text node or an attribute value", async () => {
    const { escapeHtml } = await import("@/lib/tenant-render/escape");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#x27;");
    expect(escapeHtml("plain text")).toBe("plain text");
  });

  it("throws on a metadata field it does not write, so a field added to pageMetadata cannot be dropped unnoticed", async () => {
    const { metadataTags } = await import("@/lib/tenant-render/head");
    expect(() => metadataTags({ title: "x", keywords: ["a"] })).toThrow(/Unsupported metadata field/);
    expect(() => metadataTags({ title: "x", openGraph: { type: "website", locale: "en" } as never })).toThrow(/openGraph/);
    expect(() => metadataTags({ title: { default: "x" } as never })).toThrow(/string title/);
    expect(() => metadataTags({ title: "x", robots: { index: false, follow: false } })).toThrow(/robots/);
    expect(metadataTags({ title: "x", robots: { index: false } })).toBe(
      '<title>x</title><meta name="robots" content="noindex">',
    );
  });

  it("refuses a stylesheet that holds markup, so a style element can never be closed from inside", async () => {
    const { renderHead } = await import("@/lib/tenant-render/head");
    for (const css of ["a{}</style><script>x</script>", "<!-- x", "a{} <script"]) {
      expect(() => renderHead({ metadata: { title: "x" }, css })).toThrow(/markup/);
    }
  });

  it("splits React's avatar hint off the body and refuses markup that does not start with the root", async () => {
    const { splitHints } = await import("@/lib/tenant-render/live-page");
    const hint = '<link rel="preload" as="image" href="https://m.test/a.png" referrerPolicy="no-referrer"/>';
    expect(splitHints(`${hint}<div class="pg-root"></div>`)).toEqual({
      hints: [hint],
      root: '<div class="pg-root"></div>',
    });
    expect(splitHints('<div class="pg-root"></div>').hints).toEqual([]);
    expect(() => splitHints("<p>nope</p>")).toThrow(/root element/);
  });
});
