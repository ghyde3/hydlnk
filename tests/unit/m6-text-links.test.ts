import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleClick } from "@/lib/analytics/ingest/click";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
import { REMOVED_LINK, linkLabelsFromPublished } from "@/lib/analytics/dashboard/labels";
import {
  BLOCKED_FIELD_MESSAGE,
  blockedFieldErrors,
  blockedLinksInPublished,
  blockedPublishErrorHolds,
  browserHostOf,
  judgeHost,
  urlFieldsOf,
} from "@/lib/blocklist";
import {
  isHttpUrl,
  publishedDocSchema,
  toPublishForm,
  type Block,
  type DraftDoc,
  type PublishDoc,
} from "@/lib/document";
import { PAGE_ID, makeDeps } from "./analytics-ingest-helpers";
import { blocks, draftWith, noirTokens } from "./fixtures/page-document";
import { stackIsUp } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M6-29: links inside text are blocklisted, tracked and counted like every other link. The save-time
 * check (database function), the Publish check (platform URL parser) and the application's draft
 * check read link marks; the click redirect resolves a link mark of the PUBLISHED document only;
 * Clicks by link names a text link by its words.
 */

const TEXT_ID = "text-links-0001";
const L1 = "link-text-00001";
const L2 = "link-text-00002";
const BOLD_ID = "bold-text-00001";

const bold = (start: number, end: number) => ({ type: "bold", start, end });
const link = (start: number, end: number, id = L1, url = "https://example.com/book?x=1") => ({
  type: "link",
  start,
  end,
  id,
  url,
});

function textBlock(value: string, marks: unknown[], extra: Record<string, unknown> = {}): Block {
  return {
    id: TEXT_ID,
    type: "text",
    visible: true,
    text: value,
    marks,
    ...extra,
  } as unknown as Block;
}

const publishedOf = (...list: Block[]): PublishDoc =>
  toPublishForm(draftWith(...list) as DraftDoc, noirTokens);

const draftOf = (...list: Block[]): DraftDoc => draftWith(...list) as DraftDoc;

describe("M6-29 findLinkUrl resolves a link mark of the published document", () => {
  const doc = publishedOf(
    textBlock("Book a session or read more", [
      link(0, 4, L1, "https://example.com/book?x=1"),
      bold(5, 6),
      link(7, 14, L2, "https://other.example/path"),
    ]),
  );

  it("returns the URL stored under the mark's id", () => {
    expect(findLinkUrl(doc, L1)).toBe("https://example.com/book?x=1");
    expect(findLinkUrl(doc, L2)).toBe("https://other.example/path");
  });

  it("returns null for the text block's own id, an unknown id and a bold or italic mark", () => {
    expect(findLinkUrl(doc, TEXT_ID)).toBeNull();
    expect(findLinkUrl(doc, "nobody-here-1")).toBeNull();
    const raw = {
      ...doc,
      blocks: [
        {
          ...doc.blocks[0],
          marks: [
            { type: "bold", start: 0, end: 2, id: BOLD_ID, url: "https://evil.example" },
            {
              type: "italic",
              start: 2,
              end: 4,
              id: "ital-text-00001",
              url: "https://evil.example",
            },
          ],
        },
      ],
    } as unknown as PublishDoc;
    expect(findLinkUrl(raw, BOLD_ID)).toBeNull();
    expect(findLinkUrl(raw, "ital-text-00001")).toBeNull();
  });

  it("returns null for a link whose stored URL has another scheme or is not a plain URL", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user@host.example/",
      "ftp://a.example/",
      "",
      "not a url",
    ]) {
      const raw = {
        ...doc,
        blocks: [{ ...doc.blocks[0], marks: [link(0, 4, L1, url)] }],
      } as unknown as PublishDoc;
      expect(findLinkUrl(raw, L1), url).toBeNull();
    }
  });

  it("does not see a link mark of a text block that was hidden (Publish drops it)", () => {
    const hidden = publishedOf(textBlock("Hidden text", [link(0, 6, L1)], { visible: false }));
    expect(hidden.blocks).toEqual([]);
    expect(findLinkUrl(hidden, L1)).toBeNull();
  });

  it("every other link kind still resolves by its own id", () => {
    const mixed = publishedOf(
      blocks.link as Block,
      textBlock("Hello world", [link(0, 5)]),
      blocks.grid as Block,
    );
    expect(findLinkUrl(mixed, (blocks.link as { id: string }).id)).toBe(
      (blocks.link as { url: string }).url,
    );
    expect(findLinkUrl(mixed, L1)).toBe("https://example.com/book?x=1");
    const cell = (blocks.grid as unknown as { cells: { id: string; url: string }[] }).cells[0]!;
    expect(findLinkUrl(mixed, cell.id)).toBe(cell.url);
  });

  it("the published schema parses a link-mark document and keeps the marks", () => {
    const parsed = publishedDocSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(findLinkUrl(parsed, L1)).toBe("https://example.com/book?x=1");
  });
});

describe("M6-29 the click redirect for a link in text", () => {
  const ORIGIN = "http://mara.localhost:3000";

  /** `resolveClickTarget` as pages.ts does it, over a document in memory instead of the database. */
  function depsFor(published: unknown) {
    return makeDeps({
      resolveClickTarget: async (pageId: string, id: string) => {
        if (pageId !== PAGE_ID) return null;
        const parsed = publishedDocSchema.safeParse(published);
        if (!parsed.success) return null;
        const url = findLinkUrl(parsed.data, id);
        return url === null ? null : { url, handle: "mara", customHosts: [] };
      },
    });
  }

  const request = (id: string, query = "", headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/r/${PAGE_ID}/${id}${query}`, {
      headers: {
        host: "mara.localhost:3000",
        "user-agent": "Mozilla/5.0 (iPhone) Mobile Safari",
        ...headers,
      },
    });

  const published = JSON.parse(
    JSON.stringify(
      publishedOf(
        textBlock("Book a session now", [
          link(5, 14, L1, "https://example.com/book?x=1"),
          bold(0, 4),
        ]),
      ),
    ),
  ) as unknown;

  it("302 to exactly the published URL, no-store, no cookie, and one click row with the link id", async () => {
    const s = depsFor(published);
    const response = await handleClick(request(L1), { pageId: PAGE_ID, blockId: L1 }, s.deps);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/book?x=1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    await s.flush();
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({ page_id: PAGE_ID, block_id: L1, type: "click" });
  });

  it.each([
    ["an id that exists only in the draft", "link-draft-0001"],
    ["an unknown id", "nobody-here-1"],
    ["the text block's own id", TEXT_ID],
  ])("%s: 404 and nothing recorded", async (_name, id) => {
    const s = depsFor(published);
    const response = await handleClick(request(id), { pageId: PAGE_ID, blockId: id }, s.deps);
    expect(response.status).toBe(404);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("a link in a hidden text block is not in the published form: 404", async () => {
    const hidden = JSON.parse(
      JSON.stringify(
        publishedOf(
          textBlock("Hidden", [link(0, 6, L1)], { visible: false }),
          blocks.header as Block,
        ),
      ),
    ) as unknown;
    const s = depsFor(hidden);
    const response = await handleClick(request(L1), { pageId: PAGE_ID, blockId: L1 }, s.deps);
    expect(response.status).toBe(404);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("a link mark whose stored URL has another scheme is 404", async () => {
    const tampered = JSON.parse(JSON.stringify(published)) as {
      blocks: { marks: { url?: string }[] }[];
    };
    tampered.blocks[0]!.marks.find((mark) => "url" in mark)!.url = "javascript:alert(1)";
    const s = depsFor(tampered);
    const response = await handleClick(request(L1), { pageId: PAGE_ID, blockId: L1 }, s.deps);
    expect(response.status).toBe(404);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });

  it("the open-redirect parameters and a different Host never change Location", async () => {
    const s = depsFor(published);
    const response = await handleClick(
      request(L1, "?url=https://evil.example&to=https://evil.example&next=//evil.example", {
        "x-forwarded-host": "evil.example",
      }),
      { pageId: PAGE_ID, blockId: L1 },
      s.deps,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/book?x=1");
    const elsewhere = await handleClick(
      request(L1, "", { host: "evil.localhost:3000" }),
      { pageId: PAGE_ID, blockId: L1 },
      depsFor(published).deps,
    );
    expect(elsewhere.status).toBe(404);
  });

  it("a link id of another page's document is not resolved through this page", async () => {
    const s = depsFor(published);
    const response = await handleClick(
      new Request(`${ORIGIN}/r/00000000-0000-4000-8000-0000000000c2/${L1}`, {
        headers: { host: "mara.localhost:3000" },
      }),
      { pageId: "00000000-0000-4000-8000-0000000000c2", blockId: L1 },
      s.deps,
    );
    expect(response.status).toBe(404);
    await s.flush();
    expect(s.inserted).toEqual([]);
  });
});

describe("M6-29 Clicks by link names a text link by the words it covers", () => {
  it("uses the linked text, so 'Book a session' reads 'Book a session'", () => {
    const labels = linkLabelsFromPublished(
      publishedOf(
        textBlock("Please Book a session today", [link(7, 21, L1, "https://example.com/book")]),
      ),
    );
    expect(labels.get(L1)).toBe("Book a session");
  });

  it("keeps the first 60 characters of a long link text, on one line", () => {
    const long = "x".repeat(40) + "\n" + "y".repeat(40);
    const labels = linkLabelsFromPublished(publishedOf(textBlock(long, [link(0, 81, L1)])));
    expect(labels.get(L1)).toBe(`${"x".repeat(40)} ${"y".repeat(19)}`);
    expect(labels.get(L1)).toHaveLength(60);
  });

  it("counts code points: an emoji is one character", () => {
    const labels = linkLabelsFromPublished(publishedOf(textBlock("a\u{1F44D}b", [link(0, 3, L1)])));
    expect(labels.get(L1)).toBe("a\u{1F44D}b");
  });

  it("falls back to the host when there is no text to name it", () => {
    const raw = {
      blocks: [
        {
          id: TEXT_ID,
          type: "text",
          text: "   ",
          marks: [link(0, 3, L1, "https://shop.example/x")],
        },
      ],
    };
    expect(linkLabelsFromPublished(raw).get(L1)).toBe("shop.example");
    const empty = {
      blocks: [
        {
          id: TEXT_ID,
          type: "text",
          text: "abc",
          marks: [link(5, 9, L1, "https://shop.example/x")],
        },
      ],
    };
    expect(linkLabelsFromPublished(empty).get(L1)).toBe("shop.example");
  });

  it("does not label the text block itself or a bold mark, and a removed link has no label", () => {
    const doc = publishedOf(textBlock("Hello world", [bold(0, 5), link(6, 11, L1)]));
    const labels = linkLabelsFromPublished(doc);
    expect(labels.has(TEXT_ID)).toBe(false);
    expect([...labels.keys()]).toEqual([L1]);
    // After the link is removed and the page republished, its old clicks fall back to 'Removed link'.
    const after = linkLabelsFromPublished(publishedOf(textBlock("Hello world", [bold(0, 5)])));
    expect(after.get(L1) ?? REMOVED_LINK).toBe("Removed link");
  });

  it("reads defensively: junk marks are skipped", () => {
    const raw = {
      blocks: [
        {
          id: TEXT_ID,
          type: "text",
          text: "abc",
          marks: [
            null,
            1,
            "x",
            {},
            { type: "link" },
            { type: "link", id: 5 },
            { type: "link", id: L1, start: "a", end: 2, url: "https://a.example/" },
          ],
        },
      ],
    };
    expect(() => linkLabelsFromPublished(raw)).not.toThrow();
    expect(linkLabelsFromPublished(raw).get(L1)).toBe("a.example");
    expect(() =>
      linkLabelsFromPublished({ blocks: [{ id: TEXT_ID, type: "text", text: 7, marks: "no" }] }),
    ).not.toThrow();
  });
});

describe("M6-29 the application checks read link marks", () => {
  const draft = draftOf(
    textBlock("Book a session now", [
      bold(0, 4),
      link(5, 14, L1, "https://blocked.example/x"),
      link(15, 18, L2, "https://ok.example"),
    ]),
  );

  it("the draft-side urlFieldsOf lists each link mark under the block with the mark's id as item", () => {
    expect(urlFieldsOf(draft.blocks[0]!)).toEqual([
      { blockId: TEXT_ID, itemId: L1, value: "https://blocked.example/x" },
      { blockId: TEXT_ID, itemId: L2, value: "https://ok.example" },
    ]);
    expect(urlFieldsOf(textBlock("plain", []))).toEqual([]);
    expect(
      urlFieldsOf({ id: TEXT_ID, type: "text", visible: true, text: "plain" } as Block),
    ).toEqual([]);
  });

  it("a refused save puts the blocked-site message on that link's row, and only on it", () => {
    const errors = blockedFieldErrors(draft, {
      hosts: ["blocked.example"],
      blockIds: [TEXT_ID],
      draft,
    } as never);
    expect(errors).toEqual([
      { blockId: TEXT_ID, itemId: L1, field: "url", message: BLOCKED_FIELD_MESSAGE },
    ]);
    expect(BLOCKED_FIELD_MESSAGE).toBe("That site is blocked. Use a different link.");
  });

  it("changing the address clears the error at once", () => {
    const changed = draftOf(
      textBlock("Book a session now", [link(5, 14, L1, "https://fine.example/x")]),
    );
    expect(
      blockedFieldErrors(changed, {
        hosts: ["blocked.example"],
        blockIds: [TEXT_ID],
        draft,
      } as never),
    ).toEqual([]);
  });

  it("a failed Publish keeps its error only while the link still holds the host", () => {
    const error = {
      blockId: TEXT_ID,
      itemId: L1,
      field: "url",
      message: BLOCKED_FIELD_MESSAGE,
      host: "blocked.example",
    };
    expect(blockedPublishErrorHolds(draft, error)).toBe(true);
    expect(
      blockedPublishErrorHolds(
        draftOf(textBlock("Book a session now", [link(5, 14, L1, "https://fine.example")])),
        error,
      ),
    ).toBe(false);
    // The other link's host is not this link's problem.
    expect(blockedPublishErrorHolds(draft, { ...error, itemId: L2 })).toBe(false);
    expect(blockedPublishErrorHolds(draftOf(), error)).toBe(false);
  });

  it("the Publish check refuses a blocked link in text, one error per link with its host", () => {
    const doc = publishedOf(
      textBlock("Book a session and read more here", [
        link(0, 4, L1, "https://blocked.example/a"),
        link(7, 14, L2, "https://www.blocked.example/b"),
        link(20, 24, "link-text-00003", "https://fine.example"),
      ]),
    );
    const errors = blockedLinksInPublished(doc, ["blocked.example"]);
    expect(errors).toEqual([
      {
        blockId: TEXT_ID,
        itemId: L1,
        field: "url",
        message: BLOCKED_FIELD_MESSAGE,
        host: "blocked.example",
      },
      {
        blockId: TEXT_ID,
        itemId: L2,
        field: "url",
        message: BLOCKED_FIELD_MESSAGE,
        host: "www.blocked.example",
      },
    ]);
  });

  it("the authority rule: the platform's URL parser decides, userinfo does not hide the host", () => {
    const doc = {
      blocks: [
        {
          id: TEXT_ID,
          type: "text",
          visible: true,
          text: "abc",
          marks: [link(0, 3, L1, "https://good.example@blocked.example/")],
        },
      ],
    } as unknown as PublishDoc;
    expect(blockedLinksInPublished(doc, ["blocked.example"])).toHaveLength(1);
  });

  it("a text with no links, or only bold, is not judged", () => {
    expect(
      blockedLinksInPublished(publishedOf(textBlock("abc", [bold(0, 3)])), ["blocked.example"]),
    ).toEqual([]);
  });
});

// The shared matching table (tests/unit/fixtures/blocklist-cases.json), replayed for a link mark ----

interface Case {
  url: string;
  expect: "blocked" | "allowed";
  host?: string;
  reason?: string;
  publish?: "allowed" | "invalid";
  in?: string;
}
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/unit/fixtures/blocklist-cases.json"), "utf8"),
) as { blockedDomains: string[]; cases: Case[] };
const linkCases = fixture.cases.filter((c) => c.in === undefined);

const draftWithLink = (url: string) => ({
  version: 1,
  rev: 1,
  profile: { name: "A", bio: "", photo: null },
  theme: { ref: null, overrides: {} },
  blocks: [
    {
      id: "t-1",
      type: "text",
      visible: true,
      text: "Book a session",
      marks: [
        { type: "bold", start: 0, end: 4 },
        { type: "link", start: 5, end: 14, id: "m-1", url },
      ],
    },
  ],
});

describe("M6-29 the shared matching table, for a link mark: the Publish check (TypeScript)", () => {
  it.each(linkCases)("$expect: $url", (c) => {
    const url = c.url.trim();
    if (c.publish === "invalid") {
      expect(isHttpUrl(url)).toBe(false);
      return;
    }
    if (!isHttpUrl(url)) return;
    const doc = {
      blocks: [
        {
          id: "t-1",
          type: "text",
          visible: true,
          text: "Book a session",
          marks: [{ type: "link", start: 5, end: 14, id: "m-1", url }],
        },
      ],
    } as unknown as PublishDoc;
    const errors = blockedLinksInPublished(doc, fixture.blockedDomains);
    const verdict = c.publish ?? c.expect;
    if (verdict === "allowed") {
      expect(errors).toEqual([]);
      return;
    }
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ blockId: "t-1", itemId: "m-1", field: "url" });
    expect(judgeHost(browserHostOf(url)!, fixture.blockedDomains)).toBe(c.reason);
  });

  it("the table is not vacuous", () => {
    expect(linkCases.length).toBeGreaterThan(80);
  });
});

const { run } = await stackIsUp();

describe.skipIf(!run)(
  "M6-29 the shared matching table, for a link mark: SQL and TypeScript agree",
  () => {
    let admin: SupabaseClient;
    // A domain of this run's own, so the shared `blocked.example` row other specs add and remove is untouched.
    const DOMAIN = `tlk${Math.random().toString(36).slice(2, 8)}.example`;

    beforeAll(async () => {
      const { createClient } = await import("@supabase/supabase-js");
      admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        {
          auth: { persistSession: false },
        },
      );
      const { error } = await admin
        .from("blocked_domains")
        .insert({ domain: DOMAIN, reason: "test" });
      if (error) throw new Error(error.message);
    });

    afterAll(async () => {
      await admin.from("blocked_domains").delete().eq("domain", DOMAIN);
    });

    const rows = async (draft: unknown) => {
      const { data, error } = await admin.rpc("blocked_links_in", { p_draft: draft });
      expect(error).toBeNull();
      return data as {
        block_id: string;
        item_id: string | null;
        field: string;
        host: string;
        reason: string;
      }[];
    };

    /** The case with the fixture's domain swapped for this run's, where the URL spells it out. */
    const mapped = linkCases
      .filter((c) => c.url.includes("blocked.example"))
      .map((c) => {
        const url = c.url.replaceAll("blocked.example", DOMAIN);
        // The database keeps the last 512 characters of an over-long host: work that out from the URL.
        const host =
          c.host !== undefined && c.host.length >= 500
            ? browserHostOf(url.trim())!.slice(-512)
            : c.host?.replaceAll("blocked.example", DOMAIN);
        return { ...c, url, host };
      });

    it.each(mapped)("$expect: $url", async (c) => {
      const found = await rows(draftWithLink(c.url));
      const sqlVerdict = found.length === 0 ? "allowed" : "blocked";
      expect(sqlVerdict).toBe(c.expect);
      if (c.expect === "blocked") {
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({
          block_id: "t-1",
          item_id: "m-1",
          field: "url",
          host: c.host,
          reason: c.reason,
        });
      }
      // The Publish check on the same link agrees wherever the table says both answer alike.
      const url = c.url.trim();
      if (c.publish === undefined && isHttpUrl(url)) {
        const doc = {
          blocks: [
            {
              id: "t-1",
              type: "text",
              visible: true,
              text: "Book a session",
              marks: [{ type: "link", start: 5, end: 14, id: "m-1", url }],
            },
          ],
        } as unknown as PublishDoc;
        const errors = blockedLinksInPublished(doc, [DOMAIN]);
        expect(errors.length > 0 ? "blocked" : "allowed", url).toBe(sqlVerdict);
        // The database keeps the last 512 characters of an over-long host; the browser's reading is whole.
        if (errors.length > 0) expect(errors[0]!.host.endsWith(found[0]!.host)).toBe(true);
      }
    });

    it("covers most of the table", () => {
      expect(mapped.length).toBeGreaterThan(40);
    });

    it("a text link and a link block are refused the same way, with the mark's id as the item", async () => {
      const found = await rows({
        blocks: [
          { id: "b-1", type: "link", visible: true, label: "L", url: `https://${DOMAIN}/a` },
          {
            id: "t-1",
            type: "text",
            visible: true,
            text: "Book",
            marks: [{ type: "link", start: 0, end: 4, id: "m-1", url: `https://${DOMAIN}/b` }],
          },
        ],
      });
      expect(found.map((row) => [row.block_id, row.item_id])).toEqual(
        expect.arrayContaining([
          ["b-1", null],
          ["t-1", "m-1"],
        ]),
      );
      expect(found).toHaveLength(2);
    });
  },
);
