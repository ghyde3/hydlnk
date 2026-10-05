// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishDoc, SubPagePublish } from "@/lib/document";
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

const { renderLivePage, renderLiveSubPage, scriptTag } =
  await import("@/lib/tenant-render/live-page");
const { handleResponse, handleSubPageResponse, siteSubPageResponse } =
  await import("@/lib/tenant-render/respond");
const { tenantSitemap, siteHostOrigin } = await import("@/lib/tenant-render/sitemap");
const { subPageMetadata } = await import("@/lib/publish/share-meta");
const { metadataTags } = await import("@/lib/tenant-render/head");

/**
 * M11-06, M11-07, M11-10: a sub-page as finished HTML, the answers of its routes, its head and the
 * tenant sitemap. The database reads are stubbed; the renderer, the builder and the route logic are real.
 */

const SUB = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const sub: SubPagePublish = {
  path: "items",
  title: "Our items",
  description: "Everything for sale <today>",
  blocks: [
    {
      id: "sub-link-0001",
      type: "link",
      visible: true,
      label: "Buy the lamp",
      url: "https://shop.example/lamp",
    },
    { id: "sub-pl-00001", type: "page_link", visible: true, label: "Back home", target: "home" },
  ],
};
const index = [
  { id: SUB, path: "items", title: "Our items" },
  { id: OTHER, path: "map", title: "Find us" },
];
const home: PublishDoc = {
  ...waveGPublished,
  nav: { show: true, items: [SUB, OTHER] },
};
const URLS = { page: "https://links.example.org/items", image: "https://links.example.org/og?v=1" };
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

const drawSub = (over: Partial<Parameters<typeof renderLiveSubPage>[0]> = {}) =>
  renderLiveSubPage({
    pageId: PAGE_ID,
    subPageId: SUB,
    document: home,
    subPage: sub,
    plan: "free",
    site: {
      hrefs: { [SUB]: "/items", [OTHER]: "/map" },
      menu: {
        mode: "links",
        items: [
          { label: "Home", href: "/", current: false },
          { label: "Our items", href: "/items", current: true },
          { label: "Find us", href: "/map", current: false },
        ],
      },
    },
    urls: URLS,
    ...over,
  });

describe("M11-06 a sub-page as one finished document", () => {
  const html = drawSub();
  const doc = parse(html);

  it("is the same kind of document as Home: plain HTML, one style, one deferred script", () => {
    expect(html.startsWith('<!DOCTYPE html><html lang="en"><head>')).toBe(true);
    expect(html).not.toMatch(/__next_f|__NEXT_DATA__|\/_next\/|modulepreload/);
    expect(doc.head.querySelectorAll("style").length).toBe(1);
    expect(doc.querySelectorAll("script[src]").length).toBe(1);
    expect(doc.querySelectorAll("script").length).toBe(1);
  });

  it("carries the page id and the sub-page id on the one script, so the beacon can split views", () => {
    const script = doc.querySelector("script[src]")!;
    expect(script.getAttribute("data-page-id")).toBe(PAGE_ID);
    expect(script.getAttribute("data-sub-page-id")).toBe(SUB);
    expect(scriptTag(PAGE_ID)).not.toContain("data-sub-page-id");
    expect(() => scriptTag(PAGE_ID, "not-a-uuid")).toThrow();
    expect(() => scriptTag(PAGE_ID, `${SUB}" onload="x`)).toThrow();
  });

  it("has the title as its only h1, a site header linking Home, and the sub-page's own blocks", () => {
    expect(doc.querySelectorAll("h1").length).toBe(1);
    expect(doc.querySelector("h1")?.textContent).toBe("Our items");
    const header = doc.querySelector(".pg-sitehead-link");
    expect(header?.getAttribute("href")).toBe("/");
    expect(header?.textContent).toContain(home.profile.name);
    expect(doc.querySelector('[data-block-id="sub-link-0001"]')?.getAttribute("href")).toBe(
      "/r/" + PAGE_ID + "/sub-link-0001",
    );
    expect(doc.querySelector('[data-block-id="sub-pl-00001"]')?.getAttribute("href")).toBe("/");
    // Home's own blocks and profile are not drawn.
    expect(doc.querySelector(".pg-profile")).toBeNull();
    for (const block of home.blocks) {
      expect(doc.querySelector(`[data-block-id="${block.id}"]`), block.id).toBeNull();
    }
  });

  it("draws the menu with the current page marked, then the footer with the report link", () => {
    const menu = doc.querySelector("nav.pg-menu")!;
    expect([...menu.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/items",
      "/map",
    ]);
    expect(menu.querySelectorAll('[aria-current="page"]').length).toBe(1);
    expect(menu.querySelector('[aria-current="page"]')?.textContent).toBe("Our items");
    expect(doc.querySelector(".pg-footer a[href*='/report']")).not.toBeNull();
    expect(doc.querySelector(".pg-footer")?.textContent).toContain("HYDLNK");
    // A paid plan has no badge, as on Home.
    expect(parse(drawSub({ plan: "pro" })).querySelector(".pg-footer")?.textContent).not.toContain(
      "Made with",
    );
  });

  it("ships the rules of what it uses: the menu and the site header, none of the profile's extras", () => {
    const css = doc.head.querySelector("style")!.textContent!;
    expect(css).toContain(".pg-menu-item");
    expect(css).toContain(".pg-sitehead-link");
    expect(css).toContain(".pg-pagetitle");
    expect(css).not.toContain(".pg-logo");
  });

  it("has no library script and no third-party request: only its own script and the favicon", () => {
    const refs = [...doc.querySelectorAll("[src], link[href]:not([rel=canonical])")]
      .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
      .filter((ref) => !ref.startsWith("https://media.test/"));
    expect(refs.filter((ref) => ref.startsWith("http"))).toEqual([]);
  });

  it("escapes what the owner wrote in the title and the description", () => {
    const html = drawSub({
      subPage: { ...sub, title: "<b>x</b>", description: '"><script>1</script>' },
    });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<script>1</script>");
  });
});

describe("M11-10 the head of a sub-page", () => {
  const tags = (html: string) => parse(html).head;

  it("titles it '{page title} · {profile name}', with its own description and the site's image", () => {
    const head = tags(drawSub());
    expect(head.querySelector("title")?.textContent).toBe(`Our items · ${home.profile.name}`);
    expect(head.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Everything for sale <today>",
    );
    expect(head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(
      URLS.image,
    );
    expect(head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      `Our items · ${home.profile.name}`,
    );
    expect(head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(URLS.page);
  });

  it("has the canonical link on the primary host", () => {
    const links = tags(drawSub()).querySelectorAll('link[rel="canonical"]');
    expect(links.length).toBe(1);
    expect(links[0]?.getAttribute("href")).toBe("https://links.example.org/items");
  });

  it("without a host to name (a race with a domain removal) has a title and no canonical or image", () => {
    const head = tags(drawSub({ urls: null }));
    expect(head.querySelector("title")?.textContent).toContain("Our items");
    expect(head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(head.querySelector('meta[property="og:image"]')).toBeNull();
  });

  it("never carries the private site name (the document has no such field, and the builder reads none)", () => {
    expect(JSON.stringify(home)).not.toContain('"name":"Main page"');
    const meta = subPageMetadata(home, sub, URLS);
    expect(JSON.stringify(meta)).not.toMatch(/Main page|Page 2/);
  });

  it("an empty profile name leaves the bare page title", () => {
    const meta = subPageMetadata({ profile: { ...home.profile, name: "" } }, sub, URLS);
    expect(meta.title).toBe("Our items");
  });

  it("the head serializer escapes the canonical and refuses a non-string one or another alternates field", () => {
    expect(metadataTags({ title: "t", alternates: { canonical: 'https://a.test/"x' } })).toContain(
      'href="https://a.test/&quot;x"',
    );
    expect(() =>
      metadataTags({ title: "t", alternates: { canonical: new URL("https://a.test/") } }),
    ).toThrow();
    expect(() =>
      metadataTags({ title: "t", alternates: { canonical: "https://a.test/", languages: {} } }),
    ).toThrow();
  });

  it("Home's head is unchanged: no canonical link", () => {
    const html = renderLivePage({
      pageId: PAGE_ID,
      document: waveGPublished,
      plan: "free",
      urls: { page: "http://mara.localhost:3000/", image: "http://mara.localhost:3000/og" },
    });
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("data-sub-page-id");
  });
});

describe("M11-07 Home draws the menu from its site context", () => {
  it("adds the menu (and its rules) only when given one, and no menu otherwise", () => {
    const base = { pageId: PAGE_ID, document: waveGPublished, plan: "free", urls: null };
    const without = renderLivePage(base);
    expect(without).not.toContain("pg-menu");
    const withMenu = renderLivePage({
      ...base,
      site: {
        hrefs: { [SUB]: "/items" },
        menu: {
          mode: "links",
          items: [
            { label: "Home", href: "/", current: true },
            { label: "Our items", href: "/items", current: false },
          ],
        },
      },
    });
    const doc = parse(withMenu);
    expect(doc.querySelectorAll("nav.pg-menu a").length).toBe(2);
    expect(doc.querySelector('nav.pg-menu [aria-current="page"]')?.getAttribute("href")).toBe("/");
    expect(doc.head.querySelector("style")!.textContent).toContain(".pg-menu-item");
  });
});

const page = (document: PublishDoc, over: Record<string, unknown> = {}) => ({
  kind: "published" as const,
  page: { pageId: PAGE_ID, document, publishedAt: "2026-10-05T00:00:00Z", plan: "free", ...over },
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.primary.mockResolvedValue(null);
  mocks.index.mockResolvedValue(index);
  mocks.subPage.mockImplementation(async (_page: string, id: string) =>
    id === SUB ? { id, document: sub, publishedAt: "2026-10-05T00:00:00Z" } : null,
  );
  mocks.byHandle.mockResolvedValue(page(home));
  mocks.byId.mockResolvedValue(page(home));
});

describe("M11-06 what the sub-page routes answer", () => {
  it("a live path is the page, with the canonical on the handle host when there is no custom domain", async () => {
    const response = await handleSubPageResponse("mara", "items");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('<h1 class="pg-pagetitle">Our items</h1>');
    expect(html).toContain('<link rel="canonical" href="http://mara.localhost:3000/items">');
    expect(html).toContain("http://mara.localhost:3000/og?v=");
    expect(mocks.subPage).toHaveBeenCalledWith(PAGE_ID, SUB);
  });

  it("the canonical is on the verified custom domain when the site has one, on both hosts", async () => {
    mocks.primary.mockResolvedValue("links.example.org");
    for (const response of [
      await handleSubPageResponse("mara", "items"),
      await siteSubPageResponse(PAGE_ID, "items"),
    ]) {
      expect(await response.text()).toContain(
        '<link rel="canonical" href="http://links.example.org:3000/items">',
      );
    }
  });

  it("an invented path is the plain 404 after the cached index only: the page itself is never read", async () => {
    for (const path of ["nope", "items2", "zzz-1"]) {
      const response = await handleSubPageResponse("mara", path);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toContain(
        "This page doesn’t exist or hasn’t been published yet.",
      );
    }
    expect(mocks.subPage).not.toHaveBeenCalled();
  });

  it("a path that cannot be a page (uppercase, reserved, two segments) never even reads the index", async () => {
    for (const path of ["Items", "api", "og", "a/b", "hl-query-count", "x.y", ""]) {
      expect((await handleSubPageResponse("mara", path)).status, path).toBe(404);
    }
    expect(mocks.index).not.toHaveBeenCalled();
    expect(mocks.subPage).not.toHaveBeenCalled();
  });

  it("an unpublished site, an unclaimed handle and a deleted page are the plain 404", async () => {
    mocks.byHandle.mockResolvedValue({ kind: "unpublished", pageId: PAGE_ID });
    expect((await handleSubPageResponse("mara", "items")).status).toBe(404);
    mocks.byHandle.mockResolvedValue({ kind: "missing" });
    expect((await handleSubPageResponse("mara", "items")).status).toBe(404);
    mocks.byHandle.mockResolvedValue(page(home));
    mocks.index.mockResolvedValue([index[1]]);
    expect((await handleSubPageResponse("mara", "items")).status).toBe(404);
    // In the index but its row is gone (a stale index): still a 404.
    mocks.index.mockResolvedValue(index);
    mocks.subPage.mockResolvedValue(null);
    expect((await handleSubPageResponse("mara", "items")).status).toBe(404);
  });

  it("a suspended owner is the 'isn't available' 404 on every page of the site", async () => {
    mocks.byHandle.mockResolvedValue({ kind: "suspended" });
    mocks.byId.mockResolvedValue({ kind: "suspended" });
    for (const response of [
      await handleSubPageResponse("mara", "items"),
      await siteSubPageResponse(PAGE_ID, "items"),
    ]) {
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain("This page isn’t available.");
      expect(text).not.toContain("Our items");
    }
    expect(mocks.index).not.toHaveBeenCalled();
  });

  it("redirect mode applies to a live sub-page like Home, and an invented path is still a 404", async () => {
    const link = home.blocks.find((block) => block.type === "link")!;
    const redirecting = { ...home, redirect: { linkId: link.id } };
    mocks.byHandle.mockResolvedValue(page(redirecting, { plan: "pro" }));
    const response = await handleSubPageResponse("mara", "items");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/r/${PAGE_ID}/${link.id}`);
    expect((await handleSubPageResponse("mara", "nope")).status).toBe(404);
    // The same page on a plan without the mode renders normally.
    mocks.byHandle.mockResolvedValue(page(redirecting, { plan: "free" }));
    expect((await handleSubPageResponse("mara", "items")).status).toBe(200);
  });

  it("a failure is the 500 panel, never a 404", async () => {
    mocks.index.mockRejectedValue(new Error("database down"));
    const response = await handleSubPageResponse("mara", "items");
    expect(response.status).toBe(500);
  });

  it("Home reads the index only when it draws a menu or a page link", async () => {
    mocks.byHandle.mockResolvedValue(page(waveGPublished));
    const plain = await handleResponse("mara");
    expect(plain.status).toBe(200);
    expect(mocks.index).not.toHaveBeenCalled();

    mocks.byHandle.mockResolvedValue(page(home));
    const withMenu = await handleResponse("mara");
    const doc = parse(await withMenu.text());
    expect(mocks.index).toHaveBeenCalledTimes(1);
    expect([...doc.querySelectorAll("nav.pg-menu a")].map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/items",
      "/map",
    ]);
    // Menu off: nothing drawn, and no index read for it.
    mocks.index.mockClear();
    mocks.byHandle.mockResolvedValue(page({ ...home, nav: { show: false, items: [SUB] } }));
    expect(
      parse(await (await handleResponse("mara")).text()).querySelector("nav.pg-menu"),
    ).toBeNull();
  });

  it("a menu entry for a page that is no longer live is skipped, and none live means no menu", async () => {
    mocks.byHandle.mockResolvedValue(page(home));
    mocks.index.mockResolvedValue([index[1]]);
    const doc = parse(await (await handleResponse("mara")).text());
    expect([...doc.querySelectorAll("nav.pg-menu a")].map((a) => a.textContent)).toEqual([
      "Home",
      "Find us",
    ]);
    mocks.index.mockResolvedValue([]);
    expect(
      parse(await (await handleResponse("mara")).text()).querySelector("nav.pg-menu"),
    ).toBeNull();
  });
});

describe("M11-10 the tenant sitemap and robots", () => {
  it("a handle host lists Home and each live sub-page on its own origin", async () => {
    const result = await tenantSitemap("mara.localhost:3000", "localhost:3000");
    expect(result?.status).toBe(200);
    expect([...result!.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])).toEqual([
      "http://mara.localhost:3000/",
      "http://mara.localhost:3000/items",
      "http://mara.localhost:3000/map",
    ]);
  });

  it("lists the primary host (the verified custom domain) when the site has one", async () => {
    mocks.primary.mockResolvedValue("links.example.org");
    const result = await tenantSitemap("mara.localhost:3000", "localhost:3000");
    expect(result?.body).toContain("<loc>http://links.example.org:3000/items</loc>");
    expect(result?.body).not.toContain("mara.localhost");
  });

  it("a site with no sub-pages lists Home alone; an unpublished or suspended one is 404", async () => {
    mocks.index.mockResolvedValue([]);
    const home = await tenantSitemap("mara.localhost:3000", "localhost:3000");
    expect([...home!.body.matchAll(/<loc>/g)]).toHaveLength(1);
    for (const kind of ["unpublished", "suspended", "missing"]) {
      mocks.byHandle.mockResolvedValue({ kind });
      expect((await tenantSitemap("mara.localhost:3000", "localhost:3000"))?.status, kind).toBe(
        404,
      );
    }
  });

  it("the marketing and app hosts are not a site's: the caller answers them", async () => {
    expect(await tenantSitemap("localhost:3000", "localhost:3000")).toBeNull();
    expect(await tenantSitemap("app.localhost:3000", "localhost:3000")).toBeNull();
    expect(mocks.byHandle).not.toHaveBeenCalled();
  });

  it("robots names the sitemap on a published handle host only, and on no other kind of host", async () => {
    expect(await siteHostOrigin("mara.localhost:3000", "localhost:3000")).toBe(
      "http://mara.localhost:3000",
    );
    mocks.byHandle.mockResolvedValue({ kind: "unpublished", pageId: PAGE_ID });
    expect(await siteHostOrigin("mara.localhost:3000", "localhost:3000")).toBeNull();
    expect(await siteHostOrigin("localhost:3000", "localhost:3000")).toBeNull();
    expect(await siteHostOrigin("app.localhost:3000", "localhost:3000")).toBeNull();
  });
});
