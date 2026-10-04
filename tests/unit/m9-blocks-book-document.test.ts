// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { handleClick } from "@/lib/analytics/ingest/click";
import { REMOVED_LINK, linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { blockRowSummary } from "@/components/blocks/summary";
import { PageRenderer } from "@/components/page/page-renderer";
import { blockedLinksInPublished } from "@/lib/blocklist";
import { blockedFieldErrors } from "@/lib/blocklist/fields";
import {
  BOOK_STORES,
  BOOK_STORE_LABELS,
  LIMITS,
  STORE_DUPLICATE_MESSAGE,
  STORE_MISSING_MESSAGE,
  collectImageRefs,
  collectPublishErrors,
  draftDocSchema,
  publishDocSchema,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { UPLOAD_KINDS } from "@/lib/media/limits";
import { pageRulesCss } from "@/lib/tenant-assets/css";
import { IPHONE_UA, PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import {
  OWNER_UID,
  blocks,
  bookCoverRef,
  draftWith,
  fullPublished,
  noirTokens,
} from "./fixtures/page-document";

/**
 * M9-20 on the document and the page: the `book` block's schema table, its Publish form, the id and
 * click rules, 'Clicks by link', the link blocklist, the row summary, and the one renderer's markup
 * (identical in the editor preview and on the live page, with no third party). The cover's gate
 * (the owner's folder, a missing object) is in m9-blocks-book-gate.test.ts, the controls and the
 * published page in a browser in tests/e2e/m9/blocks-book.spec.ts.
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
const book = (extra: Raw = {}): Block =>
  ({
    id: "book-m9-block1",
    type: "book",
    visible: true,
    title: "The Night Market",
    author: "Mara Okafor",
    cover: bookCoverRef,
    links: [link("book-lnk-00001", "amazon")],
    ...extra,
  }) as Block;
const doc = (...docBlocks: Raw[] | Block[]) => draftWith(...docBlocks);
const draftOk = (d: unknown) => draftDocSchema.safeParse(d).success;
const publishOk = (d: unknown) => publishDocSchema.safeParse(d).success;
const messages = (d: unknown) => collectPublishErrors(d).map((error) => error.message);
const published = (...docBlocks: Block[]): PublishDoc =>
  toPublishForm(doc(...docBlocks) as DraftDoc, noirTokens);

const THREE = [
  link("book-lnk-amazon", "amazon"),
  link("book-lnk-apple1", "apple"),
  link("book-lnk-bkshop", "bookshop"),
];

describe("M9-20 the stores and the limits", () => {
  it("has three stores in the order of the select, each with its words", () => {
    expect([...BOOK_STORES]).toEqual(["amazon", "apple", "bookshop"]);
    expect(BOOK_STORE_LABELS).toEqual({
      amazon: "Amazon",
      apple: "Apple Books",
      bookshop: "Bookshop.org",
    });
    expect(LIMITS.bookTitle).toBe(80);
    expect(LIMITS.bookAuthor).toBe(60);
    expect(LIMITS.bookLinks).toBe(3);
  });

  it("the block type sits after the contract's earlier types and the chip says Book", async () => {
    const { BLOCK_TYPES, BLOCK_TYPE_LABELS } = await import("@/lib/document");
    expect(BLOCK_TYPES.indexOf("book")).toBeGreaterThan(BLOCK_TYPES.indexOf("divider"));
    expect(BLOCK_TYPES.indexOf("apps")).toBe(BLOCK_TYPES.indexOf("book") + 1);
    expect(BLOCK_TYPE_LABELS.book).toBe("Book");
  });
});

describe("M9-20 the schema table", () => {
  it("0 links: a draft keeps it, Publish says 'Add at least one store link.' on the list", () => {
    const d = doc(book({ links: [] }));
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d)).toEqual([
      { blockId: "book-m9-block1", field: "links", message: STORE_MISSING_MESSAGE },
    ]);
  });

  it.each([1, 2, 3])("%i store link(s) publish", (n) => {
    const d = doc(book({ links: THREE.slice(0, n) }));
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(true);
    expect(collectPublishErrors(d)).toEqual([]);
  });

  it("4 links are refused in the draft and at Publish, with the limit's sentence", () => {
    const four = [...THREE, link("book-lnk-extra1", "amazon")];
    expect(draftOk(doc(book({ links: four })))).toBe(false);
    expect(publishOk(doc(book({ links: four })))).toBe(false);
    expect(messages(doc(book({ links: four })))).toContain("You can add up to 3 stores.");
  });

  it("a repeated store: 'Each store can be added once.' on the second row's store field", () => {
    const d = doc(
      book({ links: [link("book-lnk-00001", "amazon"), link("book-lnk-00002", "amazon")] }),
    );
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d)).toEqual([
      {
        blockId: "book-m9-block1",
        itemId: "book-lnk-00002",
        field: "store",
        message: STORE_DUPLICATE_MESSAGE,
      },
    ]);
  });

  it("an unknown store ('kindle') is a draft the editor shows and a Publish error on that row", () => {
    const d = doc(book({ links: [link("book-lnk-00001", "kindle")] }));
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d)).toEqual([
      expect.objectContaining({
        blockId: "book-m9-block1",
        itemId: "book-lnk-00001",
        field: "store",
        message: "Pick Amazon, Apple Books or Bookshop.org.",
      }),
    ]);
  });

  it("a missing cover is fine, whether it is null or left out (a missing key reads as null)", () => {
    expect(publishOk(doc(book({ cover: null })))).toBe(true);
    const noKey = book();
    delete (noKey as unknown as Raw).cover;
    expect(publishOk(doc(noKey))).toBe(true);
    const parsed = draftDocSchema.parse(doc(noKey));
    expect((parsed.blocks[0] as { cover: unknown }).cover).toBeNull();
  });

  it("the title is required at Publish and at most 80 characters; the author is optional, at most 60", () => {
    expect(messages(doc(book({ title: "" })))).toEqual(["Add a book title."]);
    expect(draftOk(doc(book({ title: "" })))).toBe(true);
    expect(publishOk(doc(book({ title: "x".repeat(80) })))).toBe(true);
    expect(draftOk(doc(book({ title: "x".repeat(81) })))).toBe(false);
    expect(publishOk(doc(book({ title: "x".repeat(81) })))).toBe(false);
    expect(publishOk(doc(book({ author: "" })))).toBe(true);
    expect(publishOk(doc(book({ author: "x".repeat(60) })))).toBe(true);
    expect(publishOk(doc(book({ author: "x".repeat(61) })))).toBe(false);
    // Code points, not UTF-16 units: 80 emoji are 80.
    expect(publishOk(doc(book({ title: "\u{1F4D6}".repeat(80) })))).toBe(true);
    expect(publishOk(doc(book({ title: "\u{1F4D6}".repeat(81) })))).toBe(false);
  });

  it("a line break, a control or a bidi character in the title or author is refused at Publish", () => {
    for (const bad of ["Two\nlines", "Bell\u0007", "Mara‮Okafor", "Iso⁦late"]) {
      expect(publishOk(doc(book({ title: bad }))), JSON.stringify(bad)).toBe(false);
      expect(publishOk(doc(book({ author: bad }))), JSON.stringify(bad)).toBe(false);
    }
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,x"],
    ["https://user@host.example/"],
    ["//evil.example"],
    ["ftp://example.com/book"],
    ["https://example.com/a b"],
    ["x".repeat(2049)],
  ])("a store url of %s is a draft and a Publish error naming that row's address", (url) => {
    const d = doc(book({ links: [link("book-lnk-00001", "amazon", url)] }));
    expect(draftOk(d)).toBe(true);
    expect(publishOk(d)).toBe(false);
    expect(collectPublishErrors(d)).toEqual([
      expect.objectContaining({
        blockId: "book-m9-block1",
        itemId: "book-lnk-00001",
        field: "url",
      }),
    ]);
  });

  it("a cover path with .. or another shape is not an image reference, in any form", () => {
    for (const path of [
      `../${OWNER_UID}/cover-0123456789ab.webp`,
      `${OWNER_UID}/../cover-0123456789ab.webp`,
      "https://evil.example/cover.webp",
      `${OWNER_UID}/cover.gif`,
    ]) {
      const d = doc(book({ cover: { path, width: 10, height: 10 } }));
      expect(draftOk(d), path).toBe(false);
      expect(publishOk(d), path).toBe(false);
    }
  });

  it("a cover from another owner's folder parses (the Publish gate refuses it) and is listed with the images", () => {
    const foreign = {
      path: "00000000-0000-4000-8000-000000000bad/img-0123456789ab.webp",
      width: 10,
      height: 10,
    };
    const d = doc(book({ cover: foreign }));
    expect(publishOk(d)).toBe(true);
    const parsed = draftDocSchema.parse(d);
    expect(collectImageRefs(parsed).map((ref) => ref.path)).toContain(foreign.path);
  });

  it("a cover's focus is stripped on parse and never published", () => {
    const withFocus = { ...bookCoverRef, focus: { x: 0.2, y: 0.8 } };
    const d = doc(book({ cover: withFocus }));
    const parsed = draftDocSchema.parse(d);
    expect((parsed.blocks[0] as { cover: Raw }).cover).toEqual(bookCoverRef);
    const form = toPublishForm(parsed, noirTokens);
    expect((form.blocks[0] as { cover: Raw }).cover).toEqual(bookCoverRef);
    expect(JSON.stringify(form)).not.toContain("focus");
  });

  it("a hidden block with bad new fields does not stop Publish, and is not published", () => {
    const hidden = book({
      visible: false,
      title: "",
      links: [link("book-lnk-00001", "kindle", "javascript:alert(1)")],
    });
    const d = doc(hidden, blocks.header);
    expect(publishOk(d)).toBe(true);
    expect(published(hidden, blocks.header as Block).blocks.map((b) => b.type)).toEqual(["header"]);
  });

  it("the cover is listed with the images of the draft (so the cleanup and the undo check keep it)", () => {
    const parsed = draftDocSchema.parse(doc(book()));
    expect(collectImageRefs(parsed)).toEqual([bookCoverRef]);
  });
});

describe("M9-20 ids", () => {
  const clash = (...docBlocks: Raw[]) => draftDocSchema.safeParse(doc(...docBlocks));
  const idsMessage = "Ids must be unique within a page.";

  it("two links of one block, a link and the block, and links of two books may not share an id", () => {
    for (const d of [
      clash(book({ links: [link("book-same-id01", "amazon"), link("book-same-id01", "apple")] })),
      clash(book({ links: [link("book-m9-block1", "amazon")] })),
      clash(
        book({ id: "book-m9-aaaaa1", links: [link("book-same-id01", "amazon")] }),
        book({ id: "book-m9-bbbbb1", links: [link("book-same-id01", "amazon")] }),
      ),
      clash(blocks.link, book({ links: [link(blocks.link.id, "amazon")] })),
    ]) {
      expect(d.success).toBe(false);
      expect(d.error?.issues.map((issue) => issue.message)).toContain(idsMessage);
    }
  });

  it("a link id that is not 8 to 24 characters of the id alphabet is refused", () => {
    for (const id of ["short", "x".repeat(25), "has space 01", "slash/in/id1"]) {
      expect(draftOk(doc(book({ links: [link(id, "amazon")] }))), id).toBe(false);
    }
  });
});

describe("M9-20 the Publish form", () => {
  it("is canonical: trimmed text, the stored order, the cover as a plain reference, no empty overrides", () => {
    const form = published(
      book({
        title: "  The Night Market  ",
        author: "  Mara Okafor ",
        links: [
          link("book-lnk-bkshop", "bookshop", "https://example.com/bookshop"),
          link("book-lnk-amazon", "amazon", "  https://example.com/amazon "),
        ],
        overrides: {},
      }),
    );
    expect(form.blocks).toEqual([
      {
        id: "book-m9-block1",
        type: "book",
        visible: true,
        title: "The Night Market",
        author: "Mara Okafor",
        cover: bookCoverRef,
        links: [
          { id: "book-lnk-bkshop", store: "bookshop", url: "https://example.com/bookshop" },
          { id: "book-lnk-amazon", store: "amazon", url: "https://example.com/amazon" },
        ],
      },
    ]);
    expect(publishedDocSchema.safeParse(form).success).toBe(true);
  });

  it("keeps the block's own style (button style, color, radius) and nothing else", () => {
    const form = published(
      book({ overrides: { buttonStyle: "pill", radius: 4, accent: "#C46A4F", fontBody: "x" } }),
    );
    expect((form.blocks[0] as { overrides?: unknown }).overrides).toEqual({
      buttonStyle: "pill",
      radius: 4,
      accent: "#C46A4F",
    });
  });

  it("the shared fixture's book publishes with three stores and a cover", () => {
    const form = fullPublished.blocks.find((b) => b.type === "book");
    expect(form).toMatchObject({ type: "book", cover: bookCoverRef });
    expect((form as { links: unknown[] }).links).toHaveLength(3);
  });
});

describe("M9-20 abuse cases written as raw JSON", () => {
  it("store 'evil', a data: url, and a cover of another owner are refused or flagged for the gate; nothing unknown is kept", () => {
    const raw = book({
      store: "evil",
      links: [link("book-lnk-00001", "evil", "data:text/html,x"), link("book-lnk-00002", "amazon")],
      __proto__: { polluted: true },
      onclick: "alert(1)",
    });
    const d = doc(raw);
    expect(publishOk(d)).toBe(false);
    const fields = collectPublishErrors(d).map((e) => `${e.itemId}:${e.field}`);
    expect(fields).toEqual(["book-lnk-00001:store", "book-lnk-00001:url"]);
    const parsed = draftDocSchema.parse(d);
    expect(JSON.stringify(parsed)).not.toContain("onclick");
    expect(JSON.stringify(parsed)).not.toContain("polluted");
  });

  it("a title that is markup is a title: the block draws it as text and never as an element", () => {
    const html = renderToStaticMarkup(
      createElement(PageRenderer, {
        doc: published(book({ title: "<img src=x onerror=alert(1)>" })),
        pageId: PAGE_ID,
        mode: "live",
      }),
    );
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="alert');
  });
});

describe("M9-20 clicks: the target is the published address, by the link's id", () => {
  const form = published(book({ links: THREE }));

  it("each store link's id resolves to its own url; the block id and a stranger's id do not", () => {
    expect(findLinkUrl(form, "book-lnk-amazon")).toBe("https://example.com/amazon");
    expect(findLinkUrl(form, "book-lnk-apple1")).toBe("https://example.com/apple");
    expect(findLinkUrl(form, "book-lnk-bkshop")).toBe("https://example.com/bookshop");
    expect(findLinkUrl(form, "book-m9-block1")).toBeNull();
    expect(findLinkUrl(form, "book-lnk-gone01")).toBeNull();
  });

  it("a url that is not http(s) answers nothing even if it got into the stored form", () => {
    const bad = {
      ...form,
      blocks: [
        { ...form.blocks[0]!, links: [link("book-lnk-00001", "amazon", "javascript:alert(1)")] },
      ],
    } as unknown as PublishDoc;
    expect(findLinkUrl(bad, "book-lnk-00001")).toBeNull();
  });

  it("GET /r/<page>/<link id> answers 302 to exactly the published url, no-store, no cookie, one click row", async () => {
    const s = makeDeps({
      resolveClickTarget: vi.fn(async (pageId: string, id: string) => {
        const url = pageId === PAGE_ID ? findLinkUrl(form, id) : null;
        return url ? { url, handle: "mara", customHosts: [] } : null;
      }),
    });
    const response = await handleClick(
      new Request(
        `http://mara.localhost:3000/r/${PAGE_ID}/book-lnk-amazon?to=https://evil.example`,
        {
          headers: HEADERS,
        },
      ),
      { pageId: PAGE_ID, blockId: "book-lnk-amazon" },
      s.deps,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/amazon");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    await s.flush();
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({
      page_id: PAGE_ID,
      block_id: "book-lnk-amazon",
      type: "click",
    });
  });

  it("the book's own id, a removed store and another page's id answer 404 and insert nothing", async () => {
    for (const [pageId, id] of [
      [PAGE_ID, "book-m9-block1"],
      [PAGE_ID, "book-lnk-draft01"],
      ["00000000-0000-4000-8000-0000000000b2", "book-lnk-amazon"],
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
});

describe("M9-20 Clicks by link", () => {
  it("names a link '{title} on {store}', cut to 60 characters, and a removed one 'Removed link'", () => {
    const labels = linkLabelsFromPublished(published(book({ links: THREE })));
    expect(labels.get("book-lnk-amazon")).toBe("The Night Market on Amazon");
    expect(labels.get("book-lnk-apple1")).toBe("The Night Market on Apple Books");
    expect(labels.get("book-lnk-bkshop")).toBe("The Night Market on Bookshop.org");
    expect(labels.has("book-m9-block1")).toBe(false);

    const long = linkLabelsFromPublished(
      published(book({ title: "x".repeat(80), links: THREE.slice(0, 1) })),
    );
    expect(Array.from(long.get("book-lnk-amazon")!).length).toBeLessThanOrEqual(60);

    // The store is removed and the page republished: the old clicks have no label any more.
    const after = linkLabelsFromPublished(published(book({ links: THREE.slice(1) })));
    expect(after.get("book-lnk-amazon") ?? REMOVED_LINK).toBe(REMOVED_LINK);
  });

  it("reads a document it does not trust: an unknown store or a non-string id is skipped", () => {
    const labels = linkLabelsFromPublished({
      blocks: [
        {
          id: "book-m9-block1",
          type: "book",
          title: "T",
          links: [
            { id: "book-lnk-00001", store: "kindle", url: "https://x.example" },
            { id: 7, store: "amazon", url: "https://x.example" },
            null,
            { id: "book-lnk-00003", store: "__proto__", url: "https://x.example" },
          ],
        },
      ],
    });
    expect([...labels]).toEqual([]);
  });
});

describe("M9-20 the link blocklist reads every store address", () => {
  const form = published(
    book({
      links: [
        link("book-lnk-ok0001", "amazon", "https://shop.example/ok"),
        link("book-lnk-bad001", "apple", "https://bad.example/x"),
        link("book-lnk-ip0001", "bookshop", "http://10.0.0.1/x"),
      ],
    }),
  );

  it("the Publish check reports each blocked link with its block and link ids", () => {
    const errors = blockedLinksInPublished(form, ["bad.example"]);
    expect(errors).toEqual([
      expect.objectContaining({
        blockId: "book-m9-block1",
        itemId: "book-lnk-bad001",
        field: "url",
        host: "bad.example",
        message: "That site is blocked. Use a different link.",
      }),
      expect.objectContaining({ itemId: "book-lnk-ip0001", host: "10.0.0.1" }),
    ]);
  });

  it("a subdomain of a listed host is blocked, an unlisted host passes", () => {
    const sub = published(
      book({ links: [link("book-lnk-sub001", "amazon", "https://shop.bad.example/x")] }),
    );
    expect(blockedLinksInPublished(sub, ["bad.example"])).toHaveLength(1);
    expect(blockedLinksInPublished(sub, ["other.example"])).toEqual([]);
  });

  it("the editor shows the message under the exact row once the save refuses the host", () => {
    const draft = draftDocSchema.parse(
      doc(
        book({
          links: [
            link("book-lnk-ok0001", "amazon", "https://shop.example/ok"),
            link("book-lnk-bad001", "apple", "https://bad.example/x"),
          ],
        }),
      ),
    );
    expect(
      blockedFieldErrors(draft, { hosts: ["bad.example"], blockIds: ["book-m9-block1"] } as never),
    ).toEqual([
      {
        blockId: "book-m9-block1",
        itemId: "book-lnk-bad001",
        field: "url",
        message: "That site is blocked. Use a different link.",
      },
    ]);
  });
});

describe("M9-20 the block row", () => {
  it("shows the title and '{n} stores'", () => {
    const parse = (b: Block) => draftDocSchema.parse(doc(b)).blocks[0]!;
    expect(blockRowSummary(parse(book({ links: THREE })))).toEqual({
      typeLabel: "Book",
      title: "The Night Market",
      sub: "3 stores",
    });
    expect(blockRowSummary(parse(book()))).toMatchObject({ sub: "1 store" });
    expect(blockRowSummary(parse(book({ title: "  " })))).toMatchObject({ title: "Untitled book" });
  });
});

describe("M9-20 the renderer", () => {
  const full = book({
    title: "T".repeat(80),
    author: "A".repeat(60),
    links: THREE,
    overrides: { buttonStyle: "outline" },
  });
  const render = (mode: "live" | "preview", docBlocks: Block[] = [full], extra: Raw = {}) =>
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
      .querySelector<HTMLElement>('[data-block-type="book"]')!;

  it("draws the cover in a frame, the title, the author and one anchor per store in the stored order", () => {
    const el = root(render("live"));
    expect(el.className).toBe("pg-book");
    expect(el.getAttribute("data-block-id")).toBe("book-m9-block1");
    const img = el.querySelector("img")!;
    expect(img.closest(".pg-book-cover")).not.toBeNull();
    expect(img.getAttribute("src")).toBe(`https://media.test/media/${bookCoverRef.path}`);
    expect(img.getAttribute("alt")).toBe(`Cover of ${"T".repeat(80)}`);
    expect(img.getAttribute("width")).toBe("800");
    expect(img.getAttribute("height")).toBe("1200");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(el.querySelector("p.pg-book-title")!.textContent).toBe("T".repeat(80));
    expect(el.querySelector("p.pg-book-author")!.textContent).toBe("A".repeat(60));
    const anchors = [...el.querySelectorAll<HTMLAnchorElement>("a.pg-book-link")];
    expect(anchors.map((a) => a.textContent)).toEqual(["Amazon", "Apple Books", "Bookshop.org"]);
    expect(anchors.map((a) => a.getAttribute("data-store"))).toEqual([
      "amazon",
      "apple",
      "bookshop",
    ]);
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual(
      THREE.map((l) => `/r/${PAGE_ID}/${l.id}`),
    );
    expect(anchors[0]!.getAttribute("aria-label")).toBe(`${"T".repeat(80)} on Amazon`);
    for (const a of anchors) expect(a.getAttribute("rel")).toBe("nofollow noopener");
    expect(el.getAttribute("data-button-style")).toBe("outline");
  });

  it("no destination is in the markup, and nothing is requested from another host", () => {
    const html = render("live");
    expect(html).not.toContain("example.com");
    expect(html).not.toMatch(/https?:\/\/(?!media\.test)/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
  });

  it("is the same markup in the editor preview and on the live page", () => {
    expect(root(render("preview")).outerHTML).toBe(root(render("live")).outerHTML);
  });

  it("a book without a cover draws no frame; without an author, no author line", () => {
    const el = root(render("live", [book({ cover: null, author: "" })]));
    expect(el.querySelector(".pg-book-cover")).toBeNull();
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".pg-book-author")).toBeNull();
  });

  it("a thumbnail (the editor's small copy) draws the buttons as inert boxes", () => {
    const el = root(render("preview", [full], { thumbnail: true }));
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.querySelectorAll("div.pg-book-link")).toHaveLength(3);
  });

  it("a store this version does not know draws no button (stored data is not trusted)", () => {
    const hostile = {
      ...published(book({ links: THREE })),
    } as unknown as PublishDoc;
    (hostile.blocks[0] as unknown as { links: Raw[] }).links[1]!.store = "__proto__";
    const html = renderToStaticMarkup(
      createElement(PageRenderer, { doc: hostile, pageId: PAGE_ID, mode: "live" }),
    );
    expect(html.match(/class="pg-book-link"/g)).toHaveLength(2);
  });

  it("the block's CSS is in the page's style only when the page has one", () => {
    expect(pageRulesCss(["link"])).not.toContain("pg-book");
    expect(pageRulesCss(["link", "book"])).toContain(".pg-book-link");
    expect(pageRulesCss(["book"])).toContain(".pg-book-cover");
    expect(pageRulesCss(["book"])).not.toContain("pg-map");
    expect(pageRulesCss(["book"])).not.toContain("pg-app");
  });

  it("the stylesheet reads --t-* variables only, has no color literal, and caps the cover's radius at 12px", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/components/page/page-renderer.css"),
      "utf8",
    );
    const start = css.indexOf("/* Book links (M9-20)");
    const end = css.indexOf("/* App store buttons (M9-21)");
    const section = css.slice(start, end);
    expect(section.length).toBeGreaterThan(500);
    expect(section).not.toMatch(/--hl-/);
    expect(section).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(section).not.toMatch(/\brgba?\(/);
    expect(section).toMatch(/min\(var\(--t-radius\), 12px\)/);
    expect(section).toMatch(/aspect-ratio: 2 \/ 3/);
    expect(section).toMatch(/min-height: 44px/);
  });
});

describe("M9-20 uploads", () => {
  it("the cover uses the existing upload kinds: there is no new one", () => {
    expect([...UPLOAD_KINDS]).toEqual(["avatar", "background", "content"]);
  });

  it("the cover control uploads with kind=content", () => {
    const form = readFileSync(
      resolve(process.cwd(), "src/components/blocks/forms/store-forms.tsx"),
      "utf8",
    );
    expect(form).toMatch(/kind="content"/);
    expect(form).toMatch(/label="cover"/);
  });
});
