// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { findLinkUrl, locationFor } from "@/lib/analytics/ingest/target";
import { blockRowSummary } from "@/components/blocks/summary";
import { PageRenderer } from "@/components/page/page-renderer";
import { blockedLinksInPublished } from "@/lib/blocklist";
import {
  LIMITS,
  collectPublishErrors,
  draftDocSchema,
  isHttpUrl,
  mapQuery,
  mapTargets,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { FRAME_ORIGINS, TENANT_PAGE_CSP } from "@/lib/routing/tenant-headers";
import { pageRulesCss } from "@/lib/tenant-assets/css";
import { IPHONE_UA, PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";

/**
 * M9-22 on the document and the page: the `map` block's schema table, the pure function that builds
 * the two targets (`mapTargets`), the click redirect, the labels, the row summary and the one
 * renderer's markup (an address card, no map image, no third party). The controls and the
 * published page in a browser: tests/e2e/m9/blocks-map.spec.ts.
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

const map = (extra: Raw = {}): Block =>
  ({
    id: "map-m9-block001",
    type: "map",
    visible: true,
    name: "Okafor Studio",
    address: "12 Canal Street, Brooklyn, NY 11201",
    googleId: "map-m9-google01",
    appleId: "map-m9-apple001",
    ...extra,
  }) as Block;
const doc = (...docBlocks: unknown[]) => draftWith(...docBlocks);
const draftOk = (d: unknown) => draftDocSchema.safeParse(d).success;
const publishOk = (d: unknown) => publishDocSchema.safeParse(d).success;
const published = (...docBlocks: Block[]): PublishDoc =>
  toPublishForm(doc(...docBlocks) as DraftDoc, noirTokens);
const idsMessage = "Ids must be unique within a page.";

describe("M9-22 mapTargets", () => {
  it("builds the two search URLs from fixed https hosts", () => {
    expect(mapTargets("Okafor Studio", "12 Canal Street, Brooklyn, NY 11201")).toEqual({
      google:
        "https://www.google.com/maps/search/?api=1&query=Okafor%20Studio%2012%20Canal%20Street%2C%20Brooklyn%2C%20NY%2011201",
      apple:
        "https://maps.apple.com/?q=Okafor%20Studio%2012%20Canal%20Street%2C%20Brooklyn%2C%20NY%2011201",
    });
  });

  it("encodes the name and address with encodeURIComponent and reads back to the same words", () => {
    const name = "Café & Co";
    const address = 'Main St & 5th #2, "Café" <b>';
    const { google, apple } = mapTargets(name, address);
    expect(google).toBe(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`,
    );
    for (const url of [google, apple]) {
      const query = url.split(/[?&](?:query|q)=/)[1]!;
      expect(query).not.toMatch(/[&#"<>\s]/);
      expect(decodeURIComponent(query)).toBe(`${name} ${address}`);
      expect(url).toMatch(/^[\x21-\x7e]+$/);
      expect(isHttpUrl(url)).toBe(true);
      // The part after the fixed prefix has no second query parameter and no fragment.
      expect(url.split("#")).toHaveLength(1);
    }
    expect(google.split("&")).toHaveLength(2);
    expect(apple.split("&")).toHaveLength(1);
  });

  it("whatever the address says, the host is www.google.com or maps.apple.com", () => {
    for (const address of [
      "https://evil.example",
      "//evil.example/x",
      "javascript:alert(1)",
      "https://evil.example\\@www.google.com",
      "a@evil.example",
      "x/../../evil",
    ]) {
      const { google, apple } = mapTargets("Place", address);
      expect(new URL(google).hostname, address).toBe("www.google.com");
      expect(new URL(apple).hostname, address).toBe("maps.apple.com");
      expect(new URL(google).pathname).toBe("/maps/search/");
      expect(new URL(apple).pathname).toBe("/");
      expect(new URL(apple).searchParams.get("q")).toBe(`Place ${address}`);
      expect(new URL(google).searchParams.get("query")).toBe(`Place ${address}`);
    }
  });

  it("160 characters of percent signs and unicode give an ASCII Location under 2048 characters", () => {
    for (const unit of ["%", "é", "€", "\u{1F4CD}", "%é€\u{1F4CD}"]) {
      const address = Array.from(unit.repeat(200)).slice(0, 160).join("");
      const name = Array.from(unit.repeat(80)).slice(0, 60).join("");
      const { google, apple } = mapTargets(name, address);
      for (const url of [google, apple]) {
        expect(url, unit).toMatch(/^[\x21-\x7e]+$/);
        expect(url.length, unit).toBeLessThan(2048);
        expect(isHttpUrl(url), unit).toBe(true);
        expect(locationFor(url), unit).toBe(url);
      }
    }
  });

  it("a name and address that would encode past 2048 are cut from the end, never into an escape", () => {
    const name = "\u{1F4CD}".repeat(60);
    const address = "\u{1F4CD}".repeat(160);
    const query = mapQuery(name, address);
    expect(query.length).toBeLessThanOrEqual(
      2048 - "https://www.google.com/maps/search/?api=1&query=".length,
    );
    // Every escape is whole: it decodes, and what it decodes to is a prefix of the full text.
    const decoded = decodeURIComponent(query);
    expect(`${name} ${address}`.startsWith(decoded)).toBe(true);
    expect(decoded.length).toBeGreaterThan(100);
    // Ordinary text is never changed.
    expect(decodeURIComponent(mapQuery("Okafor Studio", "12 Canal Street"))).toBe(
      "Okafor Studio 12 Canal Street",
    );
  });

  it("a lone surrogate does not throw: it becomes U+FFFD", () => {
    expect(() => mapTargets("A\ud800", "B\udc00C")).not.toThrow();
    expect(decodeURIComponent(mapQuery("A\ud800", "B\udc00C"))).toBe("A� B�C");
  });

  it("a hostile, very long string costs nothing: at most 400 code points are read", () => {
    const { google } = mapTargets("x".repeat(1_000_000), "y".repeat(1_000_000));
    expect(google.length).toBeLessThan(2048);
  });
});

describe("M9-22 the schema table", () => {
  it("the limits are 60 and 160", () => {
    expect(LIMITS.mapName).toBe(60);
    expect(LIMITS.mapAddress).toBe(160);
  });

  it("empty fields: a draft keeps them, Publish names each", () => {
    const d = doc(map({ name: "", address: "" }));
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d).map((e) => [e.field, e.message])).toEqual([
      ["name", "Add a place name."],
      ["address", "Add an address."],
    ]);
  });

  it("a 61-character name and a 161-character address are refused, 60 and 160 pass", () => {
    expect(publishOk(doc(map({ name: "n".repeat(60), address: "a".repeat(160) })))).toBe(true);
    expect(draftOk(doc(map({ name: "n".repeat(61) })))).toBe(false);
    expect(publishOk(doc(map({ name: "n".repeat(61) })))).toBe(false);
    expect(draftOk(doc(map({ address: "a".repeat(161) })))).toBe(false);
    expect(publishOk(doc(map({ address: "a".repeat(161) })))).toBe(false);
  });

  it("a line break, a control or a bidi character in the address or name is refused at Publish", () => {
    for (const bad of ["Two\nlines", "Two\r\nlines", "Bell\u0007", "R‮tl", "I⁧so"]) {
      expect(publishOk(doc(map({ address: bad }))), JSON.stringify(bad)).toBe(false);
      expect(publishOk(doc(map({ name: bad }))), JSON.stringify(bad)).toBe(false);
    }
    expect(collectPublishErrors(doc(map({ address: "Two\nlines" })))).toEqual([
      expect.objectContaining({ field: "address" }),
    ]);
  });

  it("the two ids are unique across the page: equal ids, a link block's id and a slash are refused", () => {
    for (const d of [
      draftDocSchema.safeParse(doc(map({ googleId: "map-same-id001", appleId: "map-same-id001" }))),
      draftDocSchema.safeParse(doc(blocks.link, map({ googleId: blocks.link.id }))),
      draftDocSchema.safeParse(doc(map({ appleId: "map-m9-block001" }))),
      draftDocSchema.safeParse(
        doc(map(), map({ id: "map-m9-block002", appleId: "map-m9-google01" })),
      ),
    ]) {
      expect(d.success).toBe(false);
      expect(d.error?.issues.map((issue) => issue.message)).toContain(idsMessage);
    }
    for (const id of ["map/slash/id01", "short", "has space 001", "x".repeat(25)]) {
      expect(draftOk(doc(map({ googleId: id }))), id).toBe(false);
      expect(draftOk(doc(map({ appleId: id }))), id).toBe(false);
    }
  });

  it("a hidden block with bad new fields does not stop Publish and is not published", () => {
    const hidden = map({
      visible: false,
      name: "",
      googleId: "map-same-id001",
      appleId: "map-same-id001",
    });
    // Ids are checked on the whole draft (an analytics key is a key), so the hidden one keeps its own.
    const okHidden = map({ visible: false, name: "", address: "" });
    expect(publishOk(doc(okHidden, blocks.header))).toBe(true);
    expect(published(okHidden, blocks.header as Block).blocks.map((b) => b.type)).toEqual([
      "header",
    ]);
    expect(draftOk(doc(hidden))).toBe(false);
  });

  it("the Publish form is canonical: trimmed text, the two ids, only the block's own style", () => {
    const form = published(
      map({
        name: "  Okafor Studio ",
        address: " 12 Canal Street ",
        overrides: { radius: 4, bg: "#000" },
      }),
    );
    expect(form.blocks).toEqual([
      {
        id: "map-m9-block001",
        type: "map",
        visible: true,
        name: "Okafor Studio",
        address: "12 Canal Street",
        googleId: "map-m9-google01",
        appleId: "map-m9-apple001",
        overrides: { radius: 4 },
      },
    ]);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("the chip says Map and sits right after App store, the last type of Wave K's block set", async () => {
    const { BLOCK_TYPES, BLOCK_TYPE_LABELS } = await import("@/lib/document");
    expect(BLOCK_TYPE_LABELS.map).toBe("Map");
    expect(BLOCK_TYPES[BLOCK_TYPES.indexOf("apps") + 1]).toBe("map");
  });
});

describe("M9-22 clicks: the targets are built from the published name and address", () => {
  const form = published(map({ name: "Café & Co", address: 'Main St & 5th #2, "Café" <b>' }));
  const targets = mapTargets("Café & Co", 'Main St & 5th #2, "Café" <b>');

  it("each id resolves to its built target; the block's id and a stranger's id answer nothing", () => {
    expect(findLinkUrl(form, "map-m9-google01")).toBe(targets.google);
    expect(findLinkUrl(form, "map-m9-apple001")).toBe(targets.apple);
    expect(findLinkUrl(form, "map-m9-block001")).toBeNull();
    expect(findLinkUrl(form, "map-m9-stranger")).toBeNull();
  });

  it("an address that is a URL becomes a search, not a redirect", () => {
    const evil = published(map({ address: "https://evil.example/phish" }));
    for (const id of ["map-m9-google01", "map-m9-apple001"]) {
      const target = findLinkUrl(evil, id)!;
      expect(new URL(target).hostname).toMatch(/^(www\.google\.com|maps\.apple\.com)$/);
    }
  });

  it("GET /r answers 302 with exactly the built Location, no-store, no cookie, one click row each", async () => {
    const resolveClickTarget = vi.fn(async (pageId: string, id: string) => {
      const url = pageId === PAGE_ID ? findLinkUrl(form, id) : null;
      return url ? { url, handle: "mara", customHosts: [] } : null;
    });
    for (const [id, expected] of [
      ["map-m9-google01", targets.google],
      ["map-m9-apple001", targets.apple],
    ] as const) {
      const s = makeDeps({ resolveClickTarget });
      const response = await handleClick(
        // The query string, the Host header and open-redirect parameters never change the Location.
        new Request(
          `http://mara.localhost:3000/r/${PAGE_ID}/${id}?to=https://evil.example&url=//evil.example&q=x`,
          { headers: { ...HEADERS, referer: "https://evil.example/" } },
        ),
        { pageId: PAGE_ID, blockId: id },
        s.deps,
      );
      expect(response.status, id).toBe(302);
      expect(response.headers.get("location"), id).toBe(expected);
      expect(response.headers.get("location")).not.toMatch(/[ "<>]/);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      await s.flush();
      expect(s.inserted).toHaveLength(1);
      expect(s.inserted[0]).toMatchObject({ page_id: PAGE_ID, block_id: id, type: "click" });
    }
  });

  it("an id that exists only in the draft, in another page or under the block's own id answers 404", async () => {
    for (const [pageId, id] of [
      [PAGE_ID, "map-m9-draft0001"],
      [PAGE_ID, "map-m9-block001"],
      ["00000000-0000-4000-8000-0000000000b2", "map-m9-google01"],
    ] as const) {
      const s = makeDeps({
        resolveClickTarget: vi.fn(async (page: string, blockId: string) => {
          const url = page === PAGE_ID ? findLinkUrl(form, blockId) : null;
          return url ? { url, handle: "mara", customHosts: [] } : null;
        }),
      });
      const response = await handleClick(
        new Request(`http://mara.localhost:3000/r/${pageId}/${id}`, {
          headers: HEADERS,
        }),
        { pageId, blockId: id },
        s.deps,
      );
      expect(response.status, `${pageId} ${id}`).toBe(404);
      await s.flush();
      expect(s.inserted).toEqual([]);
    }
  });

  it("Clicks by link names the two buttons, and a removed block's ids read as removed", () => {
    const labels = linkLabelsFromPublished(form);
    expect(labels.get("map-m9-google01")).toBe("Map: Google Maps");
    expect(labels.get("map-m9-apple001")).toBe("Map: Apple Maps");
    expect(labels.has("map-m9-block001")).toBe(false);
    expect(linkLabelsFromPublished(published(blocks.header as Block)).has("map-m9-google01")).toBe(
      false,
    );
  });

  it("the link blocklist sees the two targets as a defense: listed google.com would refuse the card", () => {
    expect(blockedLinksInPublished(form, ["bad.example"])).toEqual([]);
    expect(blockedLinksInPublished(form, ["google.com"])).toEqual([
      expect.objectContaining({
        blockId: "map-m9-block001",
        itemId: "map-m9-google01",
        host: "www.google.com",
      }),
    ]);
  });
});

describe("M9-22 the block row", () => {
  it("shows the place name and its address", () => {
    const parsed = draftDocSchema.parse(doc(map())).blocks[0]!;
    expect(blockRowSummary(parsed)).toEqual({
      typeLabel: "Map",
      title: "Okafor Studio",
      sub: "12 Canal Street, Brooklyn, NY 11201",
    });
    const empty = draftDocSchema.parse(doc(map({ name: " ", address: "" }))).blocks[0]!;
    expect(blockRowSummary(empty)).toMatchObject({ title: "Untitled map", sub: "" });
  });
});

describe("M9-22 the renderer", () => {
  const hostile = map({
    name: "<img src=x onerror=alert(1)>",
    address: "</p><script>alert(1)</script>",
  });
  const render = (mode: "live" | "preview", docBlocks: Block[] = [map()], extra: Raw = {}) =>
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
      .querySelector<HTMLElement>('[data-block-type="map"]')!;

  it("draws the art, the name, the address and the 'Open in Maps' chooser with its two links", () => {
    const el = root(render("live"));
    expect(el.className).toBe("pg-map");
    expect(el.querySelector("svg.pg-map-art")!.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector("p.pg-map-name")!.textContent).toBe("Okafor Studio");
    expect(el.querySelector("p.pg-map-address")!.textContent).toBe(
      "12 Canal Street, Brooklyn, NY 11201",
    );
    expect(el.querySelector(".pg-map-open")!.textContent).toBe("Open in Maps");
    const links = [...el.querySelectorAll<HTMLAnchorElement>("a.pg-map-link")];
    expect(links.map((a) => a.getAttribute("data-map"))).toEqual(["google", "apple"]);
    expect(links.map((a) => a.textContent)).toEqual(["Google Maps", "Apple Maps"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/r/${PAGE_ID}/map-m9-google01`,
      `/r/${PAGE_ID}/map-m9-apple001`,
    ]);
    expect(links.map((a) => a.getAttribute("aria-label"))).toEqual([
      "Open Okafor Studio in Google Maps",
      "Open Okafor Studio in Apple Maps",
    ]);
    for (const a of links) expect(a.getAttribute("rel")).toBe("nofollow noopener");
    // The chooser is a named group; the card has no DOM id, so two copies of the page (the editor's
    // thumbnail and its sheet) never repeat one.
    expect(el.querySelector('[role="group"]')!.getAttribute("aria-label")).toBe("Open in Maps");
    expect(el.querySelectorAll("[id]")).toHaveLength(0);
  });

  it("has no image, no iframe, no script and no address of any host: the destinations are not in the markup", () => {
    const html = render("live");
    expect(html).not.toMatch(/<img|<iframe|<script|<object|<embed|<link|<video/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/google\.com|maps\.apple\.com|openstreetmap|mapbox|tile\./i);
    expect(html).not.toContain("Canal%20Street");
  });

  it("the decorative art is under 1 KB and uses only classes, no color", () => {
    const svg = render("live").match(/<svg class="pg-map-art".*?<\/svg>/)![0];
    expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(1024);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb|fill="|stroke="|style=/);
  });

  it("is the same markup in the editor preview and on the live page", () => {
    expect(root(render("preview")).outerHTML).toBe(root(render("live")).outerHTML);
  });

  it("a name that is markup and an address that closes the paragraph are text, never elements", () => {
    const html = render("live", [hostile]);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    const el = root(html);
    expect(el.querySelectorAll("p")).toHaveLength(3);
  });

  it("a thumbnail (the editor's small copy) draws the two links as inert boxes", () => {
    const el = root(render("preview", [map()], { thumbnail: true }));
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.querySelectorAll("div.pg-map-link")).toHaveLength(2);
  });

  it("the tenant policy gains nothing for it: no image, frame or connect source of a map host", () => {
    expect(TENANT_PAGE_CSP).not.toMatch(/google|maps\.apple\.com|openstreetmap|mapbox|tile\./i);
    const frames = /frame-src ([^;]*);/.exec(TENANT_PAGE_CSP)![1]!.split(" ");
    expect(frames).toEqual([...FRAME_ORIGINS]);
    expect(TENANT_PAGE_CSP).toMatch(/img-src 'self' http[^;]*;/);
  });

  it("the block's CSS is in the page's style only when the page has one", () => {
    expect(pageRulesCss(["link", "book", "apps"])).not.toContain("pg-map");
    expect(pageRulesCss(["map"])).toContain(".pg-map-link");
    expect(pageRulesCss(["map"])).toContain(".pg-map-art");
  });

  it("the stylesheet reads --t-* variables only, has no color literal and gives each link 44px", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/page/page-renderer.css"),
      "utf8",
    );
    const section = css.slice(
      css.indexOf("/* Map location (M9-22)"),
      css.indexOf("/* Footer slot"),
    );
    expect(section.length).toBeGreaterThan(500);
    expect(section).not.toMatch(/--hl-/);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\brgba?\(/);
    expect(section).toMatch(/\.pg-map-link \{[^}]*min-height: 44px/);
    expect(section).toMatch(/border: var\(--t-border-width\) solid var\(--t-border\)/);
  });
});
