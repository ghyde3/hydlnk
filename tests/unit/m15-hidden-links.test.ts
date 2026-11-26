// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, PublishDoc, SubPagePublish } from "@/lib/document";
import { PAGE_ID, waveGPublished } from "./fixtures/m8-render-docs";

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

const mocks = vi.hoisted(() => ({
  byHandle: vi.fn(),
  byId: vi.fn(),
  check: vi.fn(),
  primary: vi.fn(),
  index: vi.fn(),
  subPage: vi.fn(),
  customDomain: vi.fn(),
}));
vi.mock("@/app/(tenant)/published-page", () => ({
  getTenantPageState: mocks.byHandle,
  getTenantSiteState: mocks.byHandle,
  getTenantPageStateById: mocks.byId,
}));
vi.mock("@/lib/handles/availability", () => ({ checkHandle: mocks.check }));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: mocks.primary }));
vi.mock("@/lib/site/published", () => ({
  getSiteIndex: mocks.index,
  getPublishedSubPage: mocks.subPage,
}));

const { PageRenderer } = await import("@/components/page/page-renderer");
const { buildMenu, hrefsOf, pageLinkHref } = await import("@/lib/site/menu");
const { homeUsesSiteIndex, siteContextFrom } = await import("@/lib/site/live");
const { listLivePagesWithClient } = await import("@/lib/site/page-entries-core");
const { handleResponse, handleSubPageResponse, siteResponse, siteSubPageResponse } =
  await import("@/lib/tenant-render/respond");
const { tenantSitemap } = await import("@/lib/tenant-render/sitemap");
const { faqJsonLd } = await import("@/lib/tenant-render/faq-json-ld");
const { pageMetadata, subPageMetadata } = await import("@/lib/publish/share-meta");

/**
 * M15-11: on the live site a menu item or a `page_link` block whose target page has no live copy is
 * not drawn, and nothing of that page (its title, its path, its id) is in the response. Publishing
 * the page brings both back. The database reads are stubbed at the site index (the published-only
 * read, checked at the bottom); the menu builder, the renderer, the document builder, the route
 * logic and the sitemap are real.
 */

/** Page A: live from the start. */
const A = "00000000-0000-4000-8000-0000000000a1";
/** Page B: in the menu and linked from Home and from A, but with no live copy at first. */
const B = "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b";
const B_TITLE = "Zebra Unpublished";
const B_PATH = "zebra-unpub";
const LINK_ID = "pl-zebra-0001";
const LINK_LABEL = "See the stripes";
const SUB_LINK_ID = "pl-zebra-0002";
const SUB_LINK_LABEL = "More stripes";

/** Everything that would give page B away, in any response. */
const SECRETS = [B_TITLE, "Zebra", B_PATH, B];
/** What the two hidden blocks themselves would add. */
const BLOCK_TRACES = [LINK_ID, LINK_LABEL, SUB_LINK_ID, SUB_LINK_LABEL];

const pageLink = (id: string, label: string, target: string): Block => ({
  id,
  type: "page_link",
  visible: true,
  label,
  target,
});

const home: PublishDoc = {
  ...waveGPublished,
  nav: { show: true, items: [A, B] },
  blocks: [...waveGPublished.blocks, pageLink(LINK_ID, LINK_LABEL, B)],
};
const subA: SubPagePublish = {
  path: "items",
  title: "Our items",
  description: "Everything for sale",
  blocks: [pageLink(SUB_LINK_ID, SUB_LINK_LABEL, B)],
};
const liveA = { id: A, path: "items", title: "Our items" };
const liveB = { id: B, path: B_PATH, title: B_TITLE };

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const expectClean = (text: string, where: string) => {
  for (const secret of [...SECRETS, ...BLOCK_TRACES]) {
    expect(text.includes(secret), `${where} must not contain "${secret}"`).toBe(false);
  }
};
const count = (text: string, needle: string) => text.split(needle).length - 1;

const published = (document: PublishDoc, over: Record<string, unknown> = {}) => ({
  kind: "published" as const,
  page: { pageId: PAGE_ID, document, publishedAt: "2026-10-05T00:00:00Z", plan: "free", ...over },
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.primary.mockResolvedValue(null);
  mocks.index.mockResolvedValue([liveA]);
  mocks.subPage.mockImplementation(async (_site: string, id: string) =>
    id === A ? { id, document: subA, publishedAt: "2026-10-05T00:00:00Z" } : null,
  );
  mocks.byHandle.mockResolvedValue(published(home));
  mocks.byId.mockResolvedValue(published(home));
});

describe("M15-11 the menu skips a page that is not live", () => {
  const nav = { show: true, items: [A, B] };

  it("nav [A, B] with only A live draws Home and A", () => {
    const menu = buildMenu(nav, [liveA], "home");
    expect(menu?.items).toEqual([
      { label: "Home", href: "/", current: true },
      { label: "Our items", href: "/items", current: false },
    ]);
    expect(JSON.stringify(menu)).not.toContain(B);
  });

  it("no live page at all draws no menu", () => {
    expect(buildMenu(nav, [], "home")).toBeNull();
    // Only the unpublished page in the menu: still nothing.
    expect(buildMenu({ show: true, items: [B] }, [liveA], "home")).toBeNull();
  });

  it("once B is live it is back, in the owner's order whatever the index order", () => {
    for (const index of [
      [liveA, liveB],
      [liveB, liveA],
    ]) {
      expect(buildMenu(nav, index, "home")?.items.map((item) => item.href)).toEqual([
        "/",
        "/items",
        `/${B_PATH}`,
      ]);
    }
    expect(
      buildMenu({ show: true, items: [B, A] }, [liveA, liveB], "home")?.items.map(
        (item) => item.label,
      ),
    ).toEqual(["Home", B_TITLE, "Our items"]);
  });

  it("the site context of a live page holds nothing of the page that is not live", () => {
    const context = siteContextFrom([liveA], home, "home");
    expect(Object.keys(context.hrefs)).toEqual([A]);
    for (const secret of SECRETS) expect(JSON.stringify(context)).not.toContain(secret);
    // Home still asks for the index: it has a menu and a page link to resolve.
    expect(homeUsesSiteIndex(home)).toBe(true);
  });
});

describe("M15-11 a page link to a page that is not live draws nothing", () => {
  const draw = (hrefs: Record<string, string> | undefined, blocks: Block[] = home.blocks) =>
    renderToStaticMarkup(
      createElement(PageRenderer, {
        doc: { ...home, blocks },
        pageId: PAGE_ID,
        mode: "live",
        ...(hrefs ? { site: { hrefs } } : {}),
      }),
    );

  it("has no href when the target is not in the live index, or there is no index", () => {
    expect(pageLinkHref(B, hrefsOf([liveA]))).toBeNull();
    expect(pageLinkHref(B, {})).toBeNull();
    expect(pageLinkHref(B, undefined)).toBeNull();
    expect(pageLinkHref(B, hrefsOf([liveA, liveB]))).toBe(`/${B_PATH}`);
  });

  it("emits no markup at all: no wrapper, no block id, no label, no target id", () => {
    for (const hrefs of [hrefsOf([liveA]), {}, undefined]) {
      const markup = draw(hrefs);
      expectClean(markup, "the renderer's markup");
      expect(markup).not.toContain('data-block-type="page_link"');
    }
  });

  it("leaves no empty element behind: the page is the one without the block", () => {
    const without = draw(hrefsOf([liveA]), waveGPublished.blocks);
    expect(draw(hrefsOf([liveA]))).toBe(without);
  });

  it("is an anchor to the page's path once the target is live", () => {
    const doc = parse(draw(hrefsOf([liveA, liveB])));
    const anchor = doc.querySelector(`[data-block-id="${LINK_ID}"]`);
    expect(anchor?.tagName).toBe("A");
    expect(anchor?.getAttribute("href")).toBe(`/${B_PATH}`);
    expect(anchor?.textContent).toBe(LINK_LABEL);
    // The target id is never an attribute, live or not.
    expect(doc.documentElement.outerHTML).not.toContain(B);
  });
});

describe("M15-11 the whole live document leaks nothing of a page that is not live", () => {
  it("Home on the handle host and on a custom host: no title, no path, no id, no hidden block", async () => {
    mocks.primary.mockResolvedValue(null);
    for (const [where, response] of [
      ["handle host", await handleResponse("mara")],
      ["custom host", await siteResponse(PAGE_ID)],
    ] as const) {
      expect(response.status, where).toBe(200);
      const html = await response.text();
      expectClean(html, `Home (${where})`);
      const doc = parse(html);
      expect(
        [...doc.querySelectorAll("nav.pg-menu a")].map((a) => a.getAttribute("href")),
        where,
      ).toEqual(["/", "/items"]);
      // No attribute of any element names the page, and the one script carries the site id only.
      for (const element of doc.querySelectorAll("*")) {
        for (const attribute of element.attributes) {
          for (const secret of SECRETS) expect(attribute.value).not.toContain(secret);
        }
      }
      const script = doc.querySelector("script[src]")!;
      expect(script.getAttribute("data-page-id")).toBe(PAGE_ID);
      expect(script.hasAttribute("data-sub-page-id")).toBe(false);
      // Nothing is serialized for a client to hydrate from.
      expect(html).not.toMatch(/__next_f|__NEXT_DATA__|\/_next\/|"nav"|"target"/);
      expect(doc.querySelectorAll("script").length).toBe(1);
    }
  });

  it("Home with only the unpublished page in its menu draws no menu and none of its rules", async () => {
    mocks.byHandle.mockResolvedValue(published({ ...home, nav: { show: true, items: [B] } }));
    mocks.index.mockResolvedValue([]);
    const html = await (await handleResponse("mara")).text();
    expectClean(html, "Home without a live page");
    expect(html).not.toContain("pg-menu");
  });

  it("a live sub-page: its menu and its own page link hide the page too", async () => {
    for (const [where, response] of [
      ["handle host", await handleSubPageResponse("mara", "items")],
      ["custom host", await siteSubPageResponse(PAGE_ID, "items")],
    ] as const) {
      expect(response.status, where).toBe(200);
      const html = await response.text();
      expectClean(html, `sub-page (${where})`);
      const doc = parse(html);
      expect(
        [...doc.querySelectorAll("nav.pg-menu a")].map((a) => a.getAttribute("href")),
        where,
      ).toEqual(["/", "/items"]);
      expect(doc.querySelector("script[src]")!.getAttribute("data-sub-page-id")).toBe(A);
    }
  });

  it("the page's own address is the plain 404 and its row is never read", async () => {
    for (const response of [
      await handleSubPageResponse("mara", B_PATH),
      await siteSubPageResponse(PAGE_ID, B_PATH),
    ]) {
      expect(response.status).toBe(404);
      expectClean(await response.text(), "the 404");
    }
    expect(mocks.subPage).not.toHaveBeenCalled();
  });

  it("the sitemap lists Home and the live page only", async () => {
    const sitemap = await tenantSitemap("mara.localhost:3000", "localhost:3000");
    expect(sitemap?.status).toBe(200);
    expectClean(sitemap!.body, "sitemap.xml");
    expect(count(sitemap!.body, "<loc>")).toBe(2);
    expect(sitemap!.body).toContain("<loc>http://mara.localhost:3000/items</loc>");
  });

  it("the head (title, description, OG and Twitter tags, canonical) and the FAQ data name nothing of it", () => {
    const urls = { page: "http://mara.localhost:3000/", image: "http://mara.localhost:3000/og" };
    expectClean(JSON.stringify(pageMetadata(home, urls)), "Home's metadata");
    expectClean(
      JSON.stringify(subPageMetadata(home, subA, { ...urls, page: `${urls.page}items` })),
      "the sub-page's metadata",
    );
    expectClean(faqJsonLd(home) ?? "", "Home's FAQ data");
    expectClean(faqJsonLd(subA) ?? "", "the sub-page's FAQ data");
  });

  it("redirect mode still answers with the link's own redirect, nothing of the page", async () => {
    const link = home.blocks.find((block) => block.type === "link")!;
    mocks.byHandle.mockResolvedValue(
      published({ ...home, redirect: { linkId: link.id } }, { plan: "pro" }),
    );
    const response = await handleResponse("mara");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/r/${PAGE_ID}/${link.id}`);
    // A page link can never be the redirect target, live or not.
    mocks.byHandle.mockResolvedValue(
      published({ ...home, redirect: { linkId: LINK_ID } }, { plan: "pro" }),
    );
    const drawn = await handleResponse("mara");
    expect(drawn.status).toBe(200);
    expectClean(await drawn.text(), "Home with a redirect to the hidden block");
  });
});

describe("M15-11 publishing the page brings both back", () => {
  beforeEach(() => {
    mocks.index.mockResolvedValue([liveA, liveB]);
    mocks.subPage.mockImplementation(async (_site: string, id: string) => {
      if (id === A) return { id, document: subA, publishedAt: "2026-10-05T00:00:00Z" };
      if (id === B) {
        return {
          id,
          document: { path: B_PATH, title: B_TITLE, description: "", blocks: [] },
          publishedAt: "2026-10-06T00:00:00Z",
        };
      }
      return null;
    });
  });

  it("Home: the menu link and the page-link button, both to the page's path", async () => {
    const html = await (await handleResponse("mara")).text();
    expect(html).toContain(B_TITLE);
    expect(count(html, `href="/${B_PATH}"`)).toBe(2);
    const doc = parse(html);
    expect(
      [...doc.querySelectorAll("nav.pg-menu a")].map((a) => [
        a.getAttribute("href"),
        a.textContent,
      ]),
    ).toEqual([
      ["/", "Home"],
      ["/items", "Our items"],
      [`/${B_PATH}`, B_TITLE],
    ]);
    const button = doc.querySelector(`[data-block-id="${LINK_ID}"]`);
    expect(button?.getAttribute("href")).toBe(`/${B_PATH}`);
    expect(button?.textContent).toBe(LINK_LABEL);
    // Still no id of the target anywhere: a live page is addressed by its path.
    expect(html).not.toContain(B);
  });

  it("a live sub-page: the menu link and its own page link", async () => {
    const html = await (await handleSubPageResponse("mara", "items")).text();
    expect(html).toContain(B_TITLE);
    expect(count(html, `href="/${B_PATH}"`)).toBe(2);
    expect(
      parse(html).querySelector(`[data-block-id="${SUB_LINK_ID}"]`)?.getAttribute("href"),
    ).toBe(`/${B_PATH}`);
  });

  it("the page answers at its path and is in the sitemap", async () => {
    const response = await handleSubPageResponse("mara", B_PATH);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`<h1 class="pg-pagetitle">${B_TITLE}</h1>`);
    const sitemap = await tenantSitemap("mara.localhost:3000", "localhost:3000");
    expect(sitemap!.body).toContain(`<loc>http://mara.localhost:3000/${B_PATH}</loc>`);
    expect(count(sitemap!.body, "<loc>")).toBe(3);
  });
});

describe("M15-11 the site index is the live pages only", () => {
  /** A stand-in for the query builder that records every filter of the entries read. */
  function recordingClient(rows: unknown[]) {
    const calls: Array<[string, ...unknown[]]> = [];
    const entries: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "neq"]) {
      entries[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return entries;
      };
    }
    entries.order = (...args: unknown[]) => {
      calls.push(["order", ...args]);
      return Promise.resolve({ data: rows, error: null });
    };
    const types = {
      select: () => types,
      eq: () => types,
      maybeSingle: () => Promise.resolve({ data: { id: "type-1" }, error: null }),
    };
    const client = { from: (table: string) => (table === "content_types" ? types : entries) };
    return { client: client as never, calls };
  }

  it("reads published copies only: the live path and the published title, never the draft", async () => {
    const { client, calls } = recordingClient([
      { id: A, live_path: "items", title: "Our items" },
      // A row the filters would never return, in case one did: no live path, so it is dropped.
      { id: B, live_path: null, title: B_TITLE },
    ]);
    const pages = await listLivePagesWithClient(client, PAGE_ID);
    expect(pages).toEqual([liveA]);
    expect(calls).toContainEqual(["not", "published", "is", null]);
    expect(calls).toContainEqual(["is", "deleted_at", null]);
    expect(calls).toContainEqual(["eq", "site_id", PAGE_ID]);
    const select = calls.find(([method]) => method === "select")!;
    expect(select[1]).toBe("id, live_path, title:published->>title");
    expect(String(select[1])).not.toContain("draft");
  });
});
