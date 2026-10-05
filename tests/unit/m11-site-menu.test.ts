// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PageRenderer } from "@/components/page/page-renderer";
import { SiteMenu } from "@/components/page/site-menu";
import { draftDocSchema, toPublishForm, type DraftDoc, type PublishDoc } from "@/lib/document";
import {
  buildMenu,
  hrefsOf,
  pageLinkHref,
  subPageHref,
  type SitePageSummary,
} from "@/lib/site/menu";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

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

const { tenantInlineCss } = await import("@/lib/tenant-assets/css");

/** M11-07: the site menu, the page-link block's href and their markup. */

const PAGE_ID = "00000000-0000-4000-8000-0000000000c1";
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const GONE = "00000000-0000-4000-8000-00000000000f";
const live: SitePageSummary[] = [
  { id: A, path: "items", title: "Items" },
  { id: B, path: "directions", title: "Directions" },
];

const pageLink = (target: string, id = "page-link-001") => ({
  id,
  type: "page_link",
  visible: true,
  label: "Go there",
  target,
});
const doc = (...extra: object[]): PublishDoc =>
  toPublishForm(
    draftDocSchema.parse({
      ...(draftWith(blocks.link, ...extra) as object),
      profile: { name: "Mara Okafor", bio: "", photo: null },
    }) as DraftDoc,
    noirTokens,
  );
const draw = (d: PublishDoc, props: object = {}, mode: "live" | "preview" = "live") =>
  renderToStaticMarkup(createElement(PageRenderer, { doc: d, pageId: PAGE_ID, mode, ...props }));

describe("M11-07 the menu data", () => {
  it("lists Home first, then the live items in the owner's order, marking the current page", () => {
    const menu = buildMenu({ show: true, items: [B, A] }, live, A);
    expect(menu?.items).toEqual([
      { label: "Home", href: "/", current: false },
      { label: "Directions", href: "/directions", current: false },
      { label: "Items", href: "/items", current: true },
    ]);
    expect(buildMenu({ show: true, items: [A] }, live, "home")?.items[0]?.current).toBe(true);
  });

  it("is null when it is off, or when no item is live", () => {
    expect(buildMenu({ show: false, items: [A] }, live, "home")).toBeNull();
    expect(buildMenu({ show: true, items: [] }, live, "home")).toBeNull();
    expect(buildMenu(undefined, live, "home")).toBeNull();
    expect(buildMenu({ show: true, items: [GONE] }, live, "home")).toBeNull();
    expect(buildMenu({ show: true, items: [A] }, [], "home")).toBeNull();
  });

  it("skips an item that is not live and a path that is malformed", () => {
    const menu = buildMenu(
      { show: true, items: [GONE, A, B] },
      [...live.slice(0, 1), { id: B, path: "../x", title: "Bad" }],
      "home",
    );
    expect(menu?.items.map((item) => item.label)).toEqual(["Home", "Items"]);
  });

  it("builds relative hrefs from a valid path only", () => {
    expect(subPageHref("items")).toBe("/items");
    for (const bad of ["", "Items", "a/b", "//evil.com", "a b", "-x"]) {
      expect(subPageHref(bad), bad).toBeNull();
    }
    expect(hrefsOf([...live, { id: GONE, path: "No/Way" }])).toEqual({
      [A]: "/items",
      [B]: "/directions",
    });
  });

  it("resolves a page-link target: Home always, a sub-page when live, else null", () => {
    const hrefs = hrefsOf(live);
    expect(pageLinkHref("home", undefined)).toBe("/");
    expect(pageLinkHref(A, hrefs)).toBe("/items");
    expect(pageLinkHref(GONE, hrefs)).toBeNull();
    expect(pageLinkHref(A, undefined)).toBeNull();
    expect(pageLinkHref("constructor", hrefs)).toBeNull();
    expect(pageLinkHref("__proto__", hrefs)).toBeNull();
  });
});

describe("M11-07 the menu markup", () => {
  const items = buildMenu({ show: true, items: [A, B] }, live, A)!.items;

  it("draws links with aria-current on the current page", () => {
    const html = renderToStaticMarkup(createElement(SiteMenu, { items, mode: "links" }));
    expect(html).toContain('<nav class="pg-menu" aria-label="Site menu"');
    expect(html).toContain('<a class="pg-menu-item" href="/">Home</a>');
    expect(html).toContain('<a class="pg-menu-item" href="/items" aria-current="page">Items</a>');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    expect(html).not.toContain("/r/");
  });

  it("draws plain text, no anchors, in text mode (the share preview)", () => {
    const html = renderToStaticMarkup(createElement(SiteMenu, { items, mode: "text" }));
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href");
    expect(html).toContain('<span class="pg-menu-item" aria-current="page">Items</span>');
  });

  it("escapes a title and draws nothing for no items", () => {
    const html = renderToStaticMarkup(
      createElement(SiteMenu, {
        items: [{ label: '<img src=x onerror="1">', href: "/x", current: false }],
        mode: "links",
      }),
    );
    expect(html).not.toContain("<img");
    expect(renderToStaticMarkup(createElement(SiteMenu, { items: [], mode: "links" }))).toBe("");
  });

  it("PageRenderer draws the menu between the profile and the blocks, and none without it", () => {
    const withMenu = draw(doc(), {
      site: { hrefs: hrefsOf(live), menu: buildMenu({ show: true, items: [A] }, live, "home") },
    });
    expect(withMenu.indexOf("pg-profile")).toBeLessThan(withMenu.indexOf("pg-menu"));
    expect(withMenu.indexOf("pg-menu")).toBeLessThan(withMenu.indexOf("pg-blocks"));
    expect(draw(doc())).not.toContain("pg-menu");
    expect(draw(doc(), { site: { hrefs: {}, menu: null } })).not.toContain("pg-menu");
  });
});

describe("M11-07 the page_link block", () => {
  const site = { hrefs: hrefsOf(live) };

  it("draws a link button with a relative href, not routed through /r", () => {
    const html = draw(doc(pageLink(A)), { site });
    expect(html).toMatch(
      /<a class="pg-link" data-block-id="page-link-001" data-block-type="page_link"[^>]*href="\/items">Go there<\/a>/,
    );
    expect(html).not.toContain("/r/00000000-0000-4000-8000-0000000000c1/page-link-001");
    const home = draw(doc(pageLink("home")), { site });
    expect(home).toMatch(/data-block-type="page_link"[^>]*href="\/">/);
  });

  it("draws nothing when the target page is gone, or when the site is unknown", () => {
    expect(draw(doc(pageLink(GONE)), { site })).not.toContain("page_link");
    expect(draw(doc(pageLink(A)))).not.toContain("page_link");
    // Home still resolves without a site.
    expect(draw(doc(pageLink("home")))).toContain('href="/"');
  });

  it("is a plain box in a thumbnail and in the same markup in the preview", () => {
    expect(draw(doc(pageLink(A)), { site, thumbnail: true })).not.toMatch(/<a [^>]*page_link/);
    expect(draw(doc(pageLink(A)), { site }, "preview")).toContain('href="/items"');
  });

  it("carries the link rules in the page's stylesheet", () => {
    const only = { ...doc(pageLink("home")), blocks: [doc(pageLink("home")).blocks.at(-1)!] };
    const css = tenantInlineCss({ blocks: only.blocks, tokens: only.tokens, menu: true });
    expect(css).toContain(".pg-link");
    expect(css).toContain(".pg-menu-item");
    expect(tenantInlineCss({ blocks: only.blocks, tokens: only.tokens })).not.toContain(".pg-menu");
  });
});

describe("M11-06 the sub-page header and title", () => {
  it("draws the site header linking to Home, the title as the only h1, and the sub-page's blocks", () => {
    const base = doc();
    const html = draw(base, {
      subPage: { title: "Our items", blocks: [pageLink("home", "sub-page-link")] },
    });
    expect(html).toContain('<a class="pg-sitehead-link" href="/">');
    expect(html).toContain("Mara Okafor");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="pg-pagetitle">Our items</h1>');
    expect(html).toContain("sub-page-link");
    // Home's own blocks are not drawn.
    expect(html).not.toContain(base.blocks[0]!.id);
    expect(html).not.toContain("pg-profile");
  });
});
