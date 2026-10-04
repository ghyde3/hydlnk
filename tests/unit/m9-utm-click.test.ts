import { afterEach, describe, expect, it, vi } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { resolveLink } from "@/lib/analytics/ingest/link-target";
import { findLinkUrl, locationFor } from "@/lib/analytics/ingest/target";
import type { ClickTarget } from "@/lib/analytics/ingest/types";
import { newBlockId, toPublishForm, withUtm, type DraftDoc, type PublishDoc } from "@/lib/document";
import { DESKTOP_UA, IPHONE_UA, PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import { blocks, fullDraft, noirTokens } from "./fixtures/page-document";

/**
 * M9-27 UTM tags at the click redirect: `Location` is `locationFor(withUtm(publishedUrl, page, link))`
 * for every link the owner typed, and the published URL itself when nothing is set. Through the real
 * resolver and handler, with spy dependencies.
 */

const PAGE = { source: "hydlnk", medium: "link-in-bio", campaign: "spring" };

const ids = {
  plain: "link-plain-001",
  own: "link-own-0001",
  off: "link-off-0001",
  partner: "link-partner-1",
  card: "card-0000001",
  image: "image-000001",
  cell: "cell-0000001",
  icon: "icon-0000001",
  mail: "icon-mail-001",
  textLink: "text-link-001",
  textBlock: "text-block-01",
};

const urls = {
  plain: "https://shop.example/p?id=1#top",
  own: "https://shop.example/own",
  off: "https://shop.example/off",
  partner: "https://shop.example/partner?utm_source=partner",
  card: "https://shop.example/card",
  image: "https://shop.example/image",
  cell: "https://shop.example/cell",
  icon: "https://instagram.com/maraokafor",
  textLink: "https://shop.example/in-text",
};

function draft(page: Record<string, string> | undefined): DraftDoc {
  const link = (id: string, url: string, extra: Record<string, unknown> = {}) => ({
    ...blocks.link,
    id,
    label: id,
    url,
    ...extra,
  });
  return {
    ...(fullDraft as object),
    ...(page ? { utm: page } : {}),
    blocks: [
      link(ids.plain, urls.plain),
      link(ids.own, urls.own, { utm: { source: "newsletter" } }),
      link(ids.off, urls.off, { utm: { off: true } }),
      link(ids.partner, urls.partner),
      { ...blocks.card, id: ids.card, url: urls.card },
      { ...blocks.image, id: ids.image, url: urls.image },
      {
        ...blocks.grid,
        cells: [
          { id: ids.cell, title: "Prints", subtitle: "", url: urls.cell },
          { id: "cell-0000002", title: "More", subtitle: "", url: "https://shop.example/more" },
        ],
      },
      {
        ...blocks.social,
        icons: [
          { id: ids.icon, platform: "instagram", url: urls.icon },
          { id: ids.mail, platform: "email", address: "hello@maraokafor.com" },
        ],
      },
      {
        ...blocks.text,
        id: ids.textBlock,
        text: "Read the shop page",
        marks: [{ type: "link", id: ids.textLink, start: 9, end: 18, url: urls.textLink }],
      },
    ],
  } as unknown as DraftDoc;
}

const docWith = (page: Record<string, string> | undefined): PublishDoc =>
  toPublishForm(draft(page), noirTokens);

function targetOf(doc: PublishDoc) {
  return async (pageId: string, id: string): Promise<ClickTarget | null> => {
    if (pageId !== PAGE_ID) return null;
    const link = resolveLink(doc, id);
    return link === null
      ? null
      : {
          url: link.url,
          ...(link.lock ? { lock: link.lock } : {}),
          handle: "mara",
          customHosts: ["links.example.test"],
        };
  };
}

async function open(
  doc: PublishDoc,
  id: string,
  init: { method?: string; query?: string; headers?: Record<string, string> } = {},
) {
  const s = makeDeps({ resolveClickTarget: vi.fn(targetOf(doc)) });
  const request = new Request(`http://mara.localhost:3000/r/${PAGE_ID}/${id}${init.query ?? ""}`, {
    method: init.method ?? "GET",
    headers: {
      host: "mara.localhost:3000",
      "user-agent": IPHONE_UA,
      "x-forwarded-for": "203.0.113.7",
      ...init.headers,
    },
  });
  const response = await handleClick(request, { pageId: PAGE_ID, blockId: id }, s.deps);
  return { response, s };
}

afterEach(() => vi.restoreAllMocks());

describe("M9-27 Location at the click redirect", () => {
  it("a link with none of its own gets the page defaults, after its query and before its fragment", async () => {
    const { response } = await open(docWith(PAGE), ids.plain);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://shop.example/p?id=1&utm_source=hydlnk&utm_medium=link-in-bio&utm_campaign=spring#top",
    );
  });

  it("a link's own source wins and keeps the page's medium and campaign", async () => {
    const { response } = await open(docWith(PAGE), ids.own);
    expect(response.headers.get("location")).toBe(
      "https://shop.example/own?utm_source=newsletter&utm_medium=link-in-bio&utm_campaign=spring",
    );
  });

  it("a link with off gets nothing at all: exactly the published URL", async () => {
    const { response } = await open(docWith(PAGE), ids.off);
    expect(response.headers.get("location")).toBe(urls.off);
  });

  it("a URL that already has utm_source=partner keeps it and gains the other two", async () => {
    const { response } = await open(docWith(PAGE), ids.partner);
    expect(response.headers.get("location")).toBe(
      "https://shop.example/partner?utm_source=partner&utm_medium=link-in-bio&utm_campaign=spring",
    );
  });

  it("every kind of link the owner typed gets the page defaults: card, image link, grid cell, icon, link inside text", async () => {
    const doc = docWith(PAGE);
    for (const [id, url] of [
      [ids.card, urls.card],
      [ids.image, urls.image],
      [ids.cell, urls.cell],
      [ids.icon, urls.icon],
      [ids.textLink, urls.textLink],
    ] as const) {
      const { response } = await open(doc, id);
      expect(response.headers.get("location"), id).toBe(withUtm(url, PAGE));
      expect(response.headers.get("location"), id).toContain("utm_source=hydlnk");
    }
  });

  it("the social email icon is not a link through /r: 404, and the mailto address is never tagged", async () => {
    const { response } = await open(docWith(PAGE), ids.mail);
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    expect(withUtm("mailto:hello@maraokafor.com", PAGE)).toBe("mailto:hello@maraokafor.com");
  });

  it("with nothing set on the page or the link, Location is exactly the published URL (M4-22)", async () => {
    const doc = docWith(undefined);
    for (const id of [ids.plain, ids.partner, ids.card, ids.cell, ids.icon, ids.textLink]) {
      const { response } = await open(doc, id);
      expect(response.headers.get("location"), id).toBe(findLinkUrl(doc, id));
    }
  });

  it("is locationFor of withUtm: a non-ASCII destination is percent-encoded once, tags included", async () => {
    const doc = structuredClone(docWith(PAGE)) as PublishDoc;
    const block = doc.blocks[0] as { url: string };
    block.url = "https://shop.example/café?q=é";
    const { response } = await open(doc, ids.plain);
    const expected = locationFor(withUtm(block.url, PAGE));
    expect(response.headers.get("location")).toBe(expected);
    expect(expected).toMatch(/^[\x21-\x7e]+$/);
    expect(expected).toContain("utm_source=hydlnk");
    expect(expected).toContain("%C3%A9");
  });

  it("HEAD answers the same Location and records nothing", async () => {
    const { response, s } = await open(docWith(PAGE), ids.own, { method: "HEAD" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("utm_source=newsletter");
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("stays no-store, never a 301/307/308, and sets no cookie", async () => {
    const { response } = await open(docWith(PAGE), ids.plain);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect([301, 307, 308]).not.toContain(response.status);
  });

  it("nothing from the request can change it: query string, utm parameters, Host variants, Referer, the open-redirect parameters", async () => {
    const doc = docWith(PAGE);
    const base = (await open(doc, ids.plain)).response.headers.get("location");
    for (const query of [
      "?utm_source=evil",
      "?utm_source=evil&utm_medium=evil&utm_campaign=evil",
      "?url=https://evil.example",
      "?to=https://evil.example&redirect=//evil.example&next=https://evil.example",
      "?utm_source=a%0d%0aSet-Cookie:x=1",
    ]) {
      const { response } = await open(doc, ids.plain, {
        query,
        headers: {
          referer: "https://evil.example/?utm_source=evil",
          "x-forwarded-host": "evil.example",
        },
      });
      expect(response.headers.get("location"), query).toBe(base);
    }
  });

  it("the click row recorded is unchanged: no UTM value is stored", async () => {
    const { s } = await open(docWith(PAGE), ids.own);
    await s.flush();
    expect(s.inserted).toHaveLength(1);
    expect(Object.keys(s.inserted[0]!).sort()).toEqual(
      ["block_id", "country", "device", "page_id", "referrer", "type", "visitor_hash"].sort(),
    );
    expect(JSON.stringify(s.inserted)).not.toMatch(/utm|hydlnk|newsletter|spring/);
  });

  it("a stored value that fails the pattern is skipped: a document that bypassed Publish cannot inject a parameter or a header", async () => {
    const doc = structuredClone(docWith(PAGE)) as PublishDoc;
    (doc as { utm?: unknown }).utm = {
      source: "a&utm_medium=evil",
      medium: "ok",
      campaign: "x\r\nSet-Cookie: y=1",
    };
    (doc.blocks[0] as { utm?: unknown }).utm = { source: "z=1" };
    const { response } = await open(doc, ids.plain);
    expect(response.headers.get("location")).toBe("https://shop.example/p?id=1&utm_medium=ok#top");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("the blocklist judges the published URL: a tag cannot change the host", () => {
    const published = "https://shop.example/p";
    for (const tagged of [
      withUtm(published, PAGE),
      withUtm(published, { source: "evil.example" }),
      withUtm(published, { source: "a@evil.example" }),
    ]) {
      expect(new URL(tagged).host).toBe(new URL(published).host);
    }
  });
});

describe("M9-27 the resolver", () => {
  it("resolves a link to its tagged URL and a card, a cell and an icon to theirs; ids that are not links to nothing", () => {
    const doc = docWith(PAGE);
    expect(resolveLink(doc, ids.own)?.url).toBe(withUtm(urls.own, PAGE, { source: "newsletter" }));
    expect(resolveLink(doc, ids.card)?.url).toBe(withUtm(urls.card, PAGE));
    expect(resolveLink(doc, ids.textBlock)).toBeNull();
    expect(resolveLink(doc, newBlockId())).toBeNull();
    expect(resolveLink(doc, ids.mail)).toBeNull();
  });

  it("only a link block's own tags count: a card or a cell with a utm key (a document that bypassed the schema) gets the page's", () => {
    const doc = structuredClone(docWith(PAGE)) as PublishDoc;
    const card = doc.blocks.find((block) => block.id === ids.card) as { utm?: unknown };
    card.utm = { off: true };
    expect(resolveLink(doc, ids.card)?.url).toBe(withUtm(urls.card, PAGE));
  });

  it("works on a desktop browser and a bot's request alike (the tags are not about who clicks)", async () => {
    for (const ua of [DESKTOP_UA, "Googlebot/2.1"]) {
      const { response } = await open(docWith(PAGE), ids.plain, { headers: { "user-agent": ua } });
      expect(response.headers.get("location")).toContain("utm_source=hydlnk");
    }
  });
});
