// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { blockRowSummary } from "@/components/blocks/summary";
import { appMarkPath, brandMarkPath } from "@/components/page/brand-marks";
import { PageRenderer } from "@/components/page/page-renderer";
import { blockedLinksInPublished } from "@/lib/blocklist";
import {
  APP_STORES,
  APP_STORE_LABELS,
  LIMITS,
  STORE_DUPLICATE_MESSAGE,
  STORE_MISSING_MESSAGE,
  appBadgeWords,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { describeTemplate } from "@/lib/templates/describe";
import { pageRulesCss } from "@/lib/tenant-assets/css";
import { IPHONE_UA, PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

/**
 * M9-21 on the document and the page: the `apps` block's schema table, its Publish form, the click
 * and label rules, the link blocklist, the row summary and the one renderer's markup (two badges
 * from fixed words and the stores' marks, the same for every visitor, nothing requested from
 * anyone). The controls and the published page in a browser: tests/e2e/m9/blocks-apps.spec.ts.
 */

vi.mock("@/lib/media/url", () => ({
  mediaUrl: (path: string) => `https://media.test/media/${path}`,
}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

type Raw = Record<string, unknown>;
/** What a visitor's browser sends: a phone's user agent (a bot's click is not recorded) and an address. */
const HEADERS = {
  host: "mara.localhost:3000",
  "user-agent": IPHONE_UA,
  "x-forwarded-for": "203.0.113.7",
};

const link = (id: string, store: string, url = `https://example.com/${store}`): Raw => ({
  id,
  store,
  url,
});
const apps = (extra: Raw = {}): Block =>
  ({
    id: "apps-m9-block1",
    type: "apps",
    visible: true,
    links: [link("apps-lnk-store1", "appstore"), link("apps-lnk-play01", "googleplay")],
    ...extra,
  }) as Block;
const doc = (...docBlocks: unknown[]) => draftWith(...docBlocks);
const draftOk = (d: unknown) => draftDocSchema.safeParse(d).success;
const publishOk = (d: unknown) => publishDocSchema.safeParse(d).success;
const published = (...docBlocks: Block[]): PublishDoc =>
  toPublishForm(doc(...docBlocks) as DraftDoc, noirTokens);

describe("M9-21 the stores and the words", () => {
  it("has two stores, in the order of the select, with their names", () => {
    expect([...APP_STORES]).toEqual(["appstore", "googleplay"]);
    expect(APP_STORE_LABELS).toEqual({ appstore: "App Store", googleplay: "Google Play" });
    expect(LIMITS.appLinks).toBe(2);
  });

  it("a badge's words and accessible name come from a fixed table", () => {
    expect(appBadgeWords("appstore")).toEqual({
      small: "Download on the",
      name: "App Store",
      label: "Download on the App Store",
    });
    expect(appBadgeWords("googleplay")).toEqual({
      small: "GET IT ON",
      name: "Google Play",
      label: "Get it on Google Play",
    });
    for (const bad of ["huawei", "__proto__", "constructor", "toString", "", null, 5, {}]) {
      expect(appBadgeWords(bad), String(bad)).toBeNull();
      expect(appMarkPath(bad), String(bad)).toBeNull();
    }
  });

  it("the marks are Simple Icons paths, not social brands, and the social table does not answer for them", () => {
    expect(appMarkPath("appstore")).toMatch(/^M/);
    expect(appMarkPath("googleplay")).toMatch(/^M/);
    expect(brandMarkPath("appstore")).toBeNull();
    expect(brandMarkPath("googleplay")).toBeNull();
  });

  it("the chip says App store and sits right after Book", async () => {
    const { BLOCK_TYPES, BLOCK_TYPE_LABELS } = await import("@/lib/document");
    expect(BLOCK_TYPE_LABELS.apps).toBe("App store");
    expect(BLOCK_TYPES[BLOCK_TYPES.indexOf("book") + 1]).toBe("apps");
  });
});

describe("M9-21 the schema table", () => {
  it("0 links: a draft keeps it, Publish says 'Add at least one store link.'", () => {
    const d = doc(apps({ links: [] }));
    expect(draftOk(d)).toBe(true);
    expect(collectPublishErrors(d)).toEqual([
      { blockId: "apps-m9-block1", field: "links", message: STORE_MISSING_MESSAGE },
    ]);
  });

  it.each([1, 2])("%i link(s) publish", (n) => {
    const d = doc(
      apps({
        links: [link("apps-lnk-store1", "appstore"), link("apps-lnk-play01", "googleplay")].slice(
          0,
          n,
        ),
      }),
    );
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(true);
    expect(collectPublishErrors(d)).toEqual([]);
  });

  it("3 links are refused in the draft and at Publish", () => {
    const three = [
      link("apps-lnk-store1", "appstore"),
      link("apps-lnk-play01", "googleplay"),
      link("apps-lnk-extra1", "appstore"),
    ];
    expect(draftOk(doc(apps({ links: three })))).toBe(false);
    expect(publishOk(doc(apps({ links: three })))).toBe(false);
  });

  it("a repeated store: 'Each store can be added once.' on the second row", () => {
    const d = doc(
      apps({ links: [link("apps-lnk-store1", "appstore"), link("apps-lnk-store2", "appstore")] }),
    );
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d)).toEqual([
      {
        blockId: "apps-m9-block1",
        itemId: "apps-lnk-store2",
        field: "store",
        message: STORE_DUPLICATE_MESSAGE,
      },
    ]);
  });

  it("an unknown store is a draft the editor shows and a Publish error on that row", () => {
    const d = doc(apps({ links: [link("apps-lnk-store1", "huawei")] }));
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d)).toEqual([
      expect.objectContaining({
        itemId: "apps-lnk-store1",
        field: "store",
        message: "Pick App Store or Google Play.",
      }),
    ]);
  });

  it.each([["javascript:alert(1)"], ["data:text/html,x"], ["//evil.example"], ["h".repeat(5000)]])(
    "a url of %s is refused at Publish, on that row's address",
    (url) => {
      const d = doc(apps({ links: [link("apps-lnk-store1", "appstore", url)] }));
      expect(publishOk(d)).toBe(false);
      expect(collectPublishErrors(d)).toEqual([
        expect.objectContaining({
          blockId: "apps-m9-block1",
          itemId: "apps-lnk-store1",
          field: "url",
        }),
      ]);
    },
  );

  it("a hidden block with bad new fields does not stop Publish and is not published", () => {
    const hidden = apps({ visible: false, links: [link("apps-lnk-store1", "huawei", "x")] });
    expect(publishOk(doc(hidden, blocks.header))).toBe(true);
    expect(published(hidden, blocks.header as Block).blocks.map((b) => b.type)).toEqual(["header"]);
  });

  it("two links of one block, a link and a block, and links of two blocks may not share an id", () => {
    for (const d of [
      doc(
        apps({ links: [link("apps-same-id01", "appstore"), link("apps-same-id01", "googleplay")] }),
      ),
      doc(apps({ links: [link("apps-m9-block1", "appstore")] })),
      doc(blocks.link, apps({ links: [link(blocks.link.id, "appstore")] })),
    ]) {
      const result = draftDocSchema.safeParse(d);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toContain(
        "Ids must be unique within a page.",
      );
    }
  });
});

describe("M9-21 the Publish form", () => {
  it("is canonical: trimmed addresses, the stored order, only the block's own style", () => {
    const form = published(
      apps({
        links: [
          link("apps-lnk-play01", "googleplay", " https://example.com/play "),
          link("apps-lnk-store1", "appstore"),
        ],
        overrides: { radius: 4, accent: "#C46A4F", fontBody: "x" },
      }),
    );
    expect(form.blocks).toEqual([
      {
        id: "apps-m9-block1",
        type: "apps",
        visible: true,
        links: [
          { id: "apps-lnk-play01", store: "googleplay", url: "https://example.com/play" },
          { id: "apps-lnk-store1", store: "appstore", url: "https://example.com/appstore" },
        ],
        overrides: { radius: 4, accent: "#C46A4F" },
      },
    ]);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });
});

describe("M9-21 clicks and Clicks by link", () => {
  const form = published(apps());

  it("each badge's own id resolves to its address; the block's id answers nothing", () => {
    expect(findLinkUrl(form, "apps-lnk-store1")).toBe("https://example.com/appstore");
    expect(findLinkUrl(form, "apps-lnk-play01")).toBe("https://example.com/googleplay");
    expect(findLinkUrl(form, "apps-m9-block1")).toBeNull();
    expect(findLinkUrl(form, "apps-lnk-gone01")).toBeNull();
  });

  it("GET /r/<page>/<badge id> answers 302 to the published address; an id of a removed store answers 404", async () => {
    const resolveClickTarget = vi.fn(async (pageId: string, id: string) => {
      const url = pageId === PAGE_ID ? findLinkUrl(form, id) : null;
      return url ? { url, handle: "mara", customHosts: [] } : null;
    });
    const hit = makeDeps({ resolveClickTarget });
    const ok = await handleClick(
      new Request(`http://mara.localhost:3000/r/${PAGE_ID}/apps-lnk-play01`, {
        headers: HEADERS,
      }),
      { pageId: PAGE_ID, blockId: "apps-lnk-play01" },
      hit.deps,
    );
    expect(ok.status).toBe(302);
    expect(ok.headers.get("location")).toBe("https://example.com/googleplay");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("set-cookie")).toBeNull();
    await hit.flush();
    expect(hit.inserted).toHaveLength(1);

    const miss = makeDeps({ resolveClickTarget });
    const gone = await handleClick(
      new Request(`http://mara.localhost:3000/r/${PAGE_ID}/apps-lnk-removed`, {
        headers: HEADERS,
      }),
      { pageId: PAGE_ID, blockId: "apps-lnk-removed" },
      miss.deps,
    );
    expect(gone.status).toBe(404);
    await miss.flush();
    expect(miss.inserted).toEqual([]);
  });

  it("names a badge 'App Store' or 'Google Play'", () => {
    const labels = linkLabelsFromPublished(form);
    expect(labels.get("apps-lnk-store1")).toBe("App Store");
    expect(labels.get("apps-lnk-play01")).toBe("Google Play");
    expect(labels.has("apps-m9-block1")).toBe(false);
  });
});

describe("M9-21 the link blocklist", () => {
  it("reads each badge's address with its block and link ids", () => {
    const form = published(
      apps({
        links: [
          link("apps-lnk-store1", "appstore", "https://apps.apple.com/app/id1"),
          link("apps-lnk-play01", "googleplay", "https://bad.example/play"),
        ],
      }),
    );
    expect(blockedLinksInPublished(form, ["bad.example"])).toEqual([
      expect.objectContaining({
        blockId: "apps-m9-block1",
        itemId: "apps-lnk-play01",
        field: "url",
        host: "bad.example",
        message: "That site is blocked. Use a different link.",
      }),
    ]);
    expect(blockedLinksInPublished(form, ["other.example"])).toEqual([]);
  });
});

describe("M9-20/21/22 the words of a template's description", () => {
  it("counts books, apps and maps: 'apps' never changes ('2 apps'), the others add an s", () => {
    const template = {
      blocks: [
        { type: "apps" },
        { type: "apps" },
        { type: "book" },
        { type: "book" },
        { type: "map" },
      ],
    } as unknown as Parameters<typeof describeTemplate>[0];
    expect(describeTemplate(template)).toBe("5 blocks: 2 apps, 2 books, map");
  });
});

describe("M9-21 the block row", () => {
  it("lists the stores and counts them", () => {
    const parse = (b: Block) => draftDocSchema.parse(doc(b)).blocks[0]!;
    expect(blockRowSummary(parse(apps()))).toEqual({
      typeLabel: "App store",
      title: "App Store, Google Play",
      sub: "2 stores",
    });
    expect(
      blockRowSummary(parse(apps({ links: [link("apps-lnk-play01", "googleplay")] }))),
    ).toEqual({ typeLabel: "App store", title: "Google Play", sub: "1 store" });
    expect(blockRowSummary(parse(apps({ links: [] })))).toMatchObject({
      title: "Untitled app store",
    });
  });
});

describe("M9-21 the renderer", () => {
  const render = (mode: "live" | "preview", docBlocks: Block[] = [apps()], extra: Raw = {}) =>
    renderToStaticMarkup(
      createElement(PageRenderer, {
        doc: published(...docBlocks),
        pageId: PAGE_ID,
        mode,
        ...extra,
      }),
    );
  const root = (html: string) =>
    new DOMParser()
      .parseFromString(`<body>${html}</body>`, "text/html")
      .querySelector<HTMLElement>('[data-block-type="apps"]')!;

  it("draws one badge per store, in the stored order, with the fixed words", () => {
    const el = root(render("live"));
    expect(el.className).toBe("pg-apps");
    const badges = [...el.querySelectorAll<HTMLAnchorElement>("a.pg-app-badge")];
    expect(badges.map((a) => a.getAttribute("data-store"))).toEqual(["appstore", "googleplay"]);
    expect(badges.map((a) => a.getAttribute("aria-label"))).toEqual([
      "Download on the App Store",
      "Get it on Google Play",
    ]);
    expect(badges.map((a) => a.textContent)).toEqual([
      "Download on theApp Store",
      "GET IT ONGoogle Play",
    ]);
    expect(badges.map((a) => a.getAttribute("href"))).toEqual([
      `/r/${PAGE_ID}/apps-lnk-store1`,
      `/r/${PAGE_ID}/apps-lnk-play01`,
    ]);
    for (const badge of badges) {
      expect(badge.getAttribute("rel")).toBe("nofollow noopener");
      const svg = badge.querySelector("svg.pg-app-mark")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.querySelectorAll("path")).toHaveLength(1);
    }
  });

  it("a reversed document draws the badges reversed: the order is the stored one, for every visitor", () => {
    const el = root(
      render("live", [
        apps({
          links: [link("apps-lnk-play01", "googleplay"), link("apps-lnk-store1", "appstore")],
        }),
      ]),
    );
    expect([...el.querySelectorAll("a")].map((a) => a.getAttribute("data-store"))).toEqual([
      "googleplay",
      "appstore",
    ]);
  });

  it("the markup depends on the document alone: nothing in the renderer reads a request or a user agent", () => {
    expect(render("live")).toBe(render("live"));
    const source = readFileSync(
      resolve(process.cwd(), "src/components/page/store-blocks.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/headers\(|cookies\(|userAgent|navigator|searchParams|request\./);
  });

  it("each badge's svg is at most 2 KB and the two together at most 4 KB", () => {
    const html = render("live");
    const svgs = html.match(/<svg class="pg-app-mark".*?<\/svg>/g) ?? [];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs)
      expect(Buffer.byteLength(svg), svg.slice(0, 40)).toBeLessThanOrEqual(2000);
    expect(svgs.reduce((sum, svg) => sum + Buffer.byteLength(svg), 0)).toBeLessThanOrEqual(4096);
  });

  it("no destination is in the markup and nothing is requested from another host", () => {
    const html = render("live");
    expect(html).not.toContain("example.com");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/apple\.com|google\.com|play\.google/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
  });

  it("is the same markup in the editor preview and on the live page", () => {
    expect(root(render("preview")).outerHTML).toBe(root(render("live")).outerHTML);
  });

  it("a store this version does not know draws no badge (stored data is not trusted)", () => {
    const hostile = published(apps());
    (hostile.blocks[0] as unknown as { links: Raw[] }).links[0]!.store = "huawei";
    const html = renderToStaticMarkup(
      createElement(PageRenderer, { doc: hostile, pageId: PAGE_ID, mode: "live" }),
    );
    expect(html.match(/pg-app-badge/g)).toHaveLength(1);
  });

  it("a thumbnail (the editor's small copy) draws inert boxes with no label", () => {
    const el = root(render("preview", [apps()], { thumbnail: true }));
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.querySelectorAll("div.pg-app-badge")).toHaveLength(2);
    expect(el.querySelector("[aria-label]")).toBeNull();
  });

  it("the block's CSS is in the page's style only when the page has one", () => {
    expect(pageRulesCss(["link", "book", "map"])).not.toContain("pg-app");
    expect(pageRulesCss(["apps"])).toContain(".pg-app-badge");
    expect(pageRulesCss(["apps"])).toContain(".pg-apps");
    expect(pageRulesCss(["apps"])).not.toContain("pg-book");
  });

  it("the stylesheet fills a badge with --t-text and letters it in --t-bg, no color literal", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/page/page-renderer.css"),
      "utf8",
    );
    const section = css.slice(
      css.indexOf("/* App store buttons (M9-21)"),
      css.indexOf("/* Map location (M9-22)"),
    );
    expect(section.length).toBeGreaterThan(500);
    expect(section).toMatch(/background: var\(--t-text\)/);
    expect(section).toMatch(/color: var\(--t-bg\)/);
    expect(section).toMatch(/border: 1px solid var\(--t-border\)/);
    expect(section).toMatch(/min-height: 48px/);
    expect(section).toMatch(/min-width: 150px/);
    expect(section).not.toMatch(/--hl-/);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\brgba?\(/);
  });
});
