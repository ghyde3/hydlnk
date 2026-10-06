/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOf as publishableDraft, makeOwner, removeOwners, stackIsUp } from "./publish-support";
import type { TestOwner } from "./publish-support";
import { adminForTests, makeRuntime, type Outcome } from "./support/mcp-db";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M12-05, the tools for sub-pages, against the local database: list_pages with each site's pages,
 * get_page and the four block tools with `subPageId`, create_page, update_page_settings, and the new
 * page_link, items and hours blocks. A sub-page of another account or another site is `not_found`
 * (the same sentence as a random id), the revision guard is the page's `updated_at`, limits and path
 * rules are the editor's, and the activity log holds no content. Skipped when the stack is not up.
 */
const { run } = await stackIsUp();

const NOT_FOUND = "We couldn’t find that page. Call list_pages to see your pages.";

describe.skipIf(!run)("the sub-page tools (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  const owners: TestOwner[] = [];

  async function owner(label: string, plan: "free" | "pro" | "studio" = "pro") {
    const made = await makeOwner(admin, label, (handle) => publishableDraft(handle), plan);
    owners.push(made);
    return made;
  }
  const who = (o: TestOwner, scopes?: string[]) => ({
    userId: o.userId,
    ...(scopes ? { scopes } : {}),
  });

  async function addSubPage(
    o: TestOwner,
    path: string,
    over: Record<string, unknown> = {},
    siteId: string = o.pageId,
  ): Promise<string> {
    const draft = { path, title: `Page ${path}`, description: "", blocks: [], ...over };
    const { data, error } = await admin
      .from("site_pages")
      .insert({ page_id: siteId, draft: draft as never })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const subRow = async (id: string) =>
    (await admin.from("site_pages").select("*").eq("id", id).single()).data as any;
  const homeRow = async (o: TestOwner) =>
    (await admin.from("pages").select("draft, published_at").eq("id", o.pageId).single())
      .data as any;
  const rev = (row: { updated_at: string }) => Date.parse(row.updated_at);
  const linkBlock = (id: string, label = "A link") => ({
    id,
    type: "link",
    visible: true,
    label,
    url: "https://example.com/x",
  });

  beforeAll(async () => {
    admin = adminForTests();
    rt = await makeRuntime(admin);
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  // -------------------------------------------------------------------------------------------
  describe("list_pages", () => {
    it("lists each site's pages: Home first, then the menu in order, then the rest, with inMenu and live", async () => {
      const o = await owner("lp-list");
      const a = await addSubPage(o, "items", { title: "Items" });
      const b = await addSubPage(o, "visit", { title: "Visit" });
      const c = await addSubPage(o, "extra", { title: "Extra" });
      // Menu order: visit, items. Extra stays out. Items is live.
      const home = await homeRow(o);
      await admin
        .from("pages")
        .update({ draft: { ...home.draft, nav: { show: true, items: [b, a] } } })
        .eq("id", o.pageId);
      await admin
        .from("site_pages")
        .update({
          published: { path: "items", title: "Items", description: "", blocks: [] },
          published_at: new Date().toISOString(),
        })
        .eq("id", a);

      const out = await rt.call("list_pages", {}, who(o));
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json!.account).toMatchObject({
        plan: "pro",
        pagesUsed: 1,
        pagesPerSiteAllowed: 10,
      });
      const site = out.json!.pages[0];
      expect(site.id).toBe(o.pageId);
      expect(site.pageCount).toBe(4);
      expect(site.pages).toEqual([
        { id: "home", title: "Home", path: "/", inMenu: true, live: false },
        { id: b, title: "Visit", path: "/visit", inMenu: true, live: false },
        { id: a, title: "Items", path: "/items", inMenu: true, live: true },
        { id: c, title: "Extra", path: "/extra", inMenu: false, live: false },
      ]);
    });

    it("never lists another account's pages", async () => {
      const mine = await owner("lp-mine");
      const theirs = await owner("lp-theirs");
      await addSubPage(theirs, "secret", { title: "Their secret page" });
      const out = await rt.call("list_pages", {}, who(mine));
      expect(JSON.stringify(out.json)).not.toContain("Their secret page");
      expect(out.json!.pages).toHaveLength(1);
      expect(out.json!.pages[0].pages).toEqual([
        { id: "home", title: "Home", path: "/", inMenu: true, live: false },
      ]);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("get_page with subPageId", () => {
    it("reads that page's draft with its own rev, title, path and menu state, and leaves Home alone", async () => {
      const o = await owner("gp-read");
      const id = await addSubPage(o, "items", {
        title: "Items",
        description: "Things for sale",
        blocks: [linkBlock("blk-sub-0001", "Sub link")],
      });
      const home = await homeRow(o);
      await admin
        .from("pages")
        .update({ draft: { ...home.draft, nav: { show: true, items: [id] } } })
        .eq("id", o.pageId);
      const row = await subRow(id);

      const out = await rt.call("get_page", { pageId: o.pageId, subPageId: id }, who(o));
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json!.page).toMatchObject({
        id: o.pageId,
        subPageId: id,
        title: "Items",
        description: "Things for sale",
        path: "/items",
        inMenu: true,
        live: false,
        publishStatus: "not-published",
        hasUnpublishedChanges: true,
        rev: rev(row),
      });
      expect(out.json!.blocks).toEqual([
        expect.objectContaining({ id: "blk-sub-0001", type: "link", label: "Sub link" }),
      ]);
      expect(out.json!.profile).toBeUndefined();
      expect(out.json!.publishIssues).toEqual([]);
    });

    it("one block in full, and block_not_found for a block of Home", async () => {
      const o = await owner("gp-block");
      const id = await addSubPage(o, "items", { blocks: [linkBlock("blk-sub-0002")] });
      const one = await rt.call(
        "get_page",
        { pageId: o.pageId, subPageId: id, blockId: "blk-sub-0002" },
        who(o),
      );
      expect(one.json!.block).toMatchObject({ id: "blk-sub-0002", type: "link" });
      const home = await rt.call(
        "get_page",
        { pageId: o.pageId, subPageId: id, blockId: "lnk-aaaaaaaa" },
        who(o),
      );
      expect(home.error!.code).toBe("block_not_found");
    });

    it("names what Publish would refuse on that page", async () => {
      const o = await owner("gp-issues");
      const id = await addSubPage(o, "items", {
        title: "",
        blocks: [{ id: "blk-bad-0001", type: "link", visible: true, label: "", url: "" }],
      });
      const out = await rt.call("get_page", { pageId: o.pageId, subPageId: id }, who(o));
      expect(out.json!.publishIssues.length).toBeGreaterThan(0);
    });

    it("home and a missing subPageId both read Home", async () => {
      const o = await owner("gp-home");
      const none = await rt.call("get_page", { pageId: o.pageId }, who(o));
      const home = await rt.call("get_page", { pageId: o.pageId, subPageId: "home" }, who(o));
      expect(home.json).toEqual(none.json);
      expect(none.json!.profile).toBeDefined();
    });

    it("another account's page, a page of another site, a random id and a malformed id are one not_found", async () => {
      const mine = await owner("gp-nf-mine");
      const theirs = await owner("gp-nf-theirs");
      const theirPage = await addSubPage(theirs, "secret", { title: "Their secret page" });
      const secondSite = await admin
        .from("pages")
        .insert({
          owner_id: mine.userId,
          handle: `${mine.handle}-b`,
          draft: publishableDraft("b") as never,
        })
        .select("id")
        .single();
      const otherSitePage = await addSubPage(mine, "elsewhere", {}, secondSite.data!.id);
      const attempts = [
        theirPage,
        theirPage.toUpperCase(),
        otherSitePage,
        "11111111-1111-4111-8111-111111111111",
        "not-a-uuid",
        "'; drop table site_pages; --",
      ];
      for (const subPageId of attempts) {
        const out = await rt.call("get_page", { pageId: mine.pageId, subPageId }, who(mine));
        expect(out.error, subPageId).toMatchObject({ code: "not_found", message: NOT_FOUND });
        expect(JSON.stringify(out.raw)).not.toContain("Their secret page");
      }
      // Without a pageId an account with one site gets the same answer for a foreign page.
      const bare = await rt.call("get_page", { subPageId: theirPage }, who(mine));
      expect(bare.error).toMatchObject({ code: "invalid_input" }); // two sites now: pageId is required
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("add_block, update_block, move_block and remove_block with subPageId", () => {
    it("add_block writes that page's draft only, with a new rev, and Home's document is untouched", async () => {
      const o = await owner("ab-sub");
      const id = await addSubPage(o, "items");
      const before = await subRow(id);
      const homeBefore = await homeRow(o);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const out = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          ifRev: rev(before),
          type: "link",
          fields: { label: "Hello", url: "https://example.com/hello" },
        },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const after = await subRow(id);
      expect(after.draft.blocks).toHaveLength(1);
      expect(after.draft.blocks[0]).toMatchObject({ label: "Hello", id: out.json!.blockId });
      expect(out.json!.rev).toBe(rev(after));
      expect(out.json!.rev).toBeGreaterThan(rev(before));
      expect(after.draft).toMatchObject({ path: "items", title: "Page items" });
      expect(await homeRow(o)).toEqual(homeBefore);
      expect(after.published).toBeNull();
    });

    it("a stale ifRev is a conflict and writes nothing; so is a save made in the editor in between", async () => {
      const o = await owner("ab-conflict");
      const id = await addSubPage(o, "items");
      const first = await subRow(id);
      await new Promise((resolve) => setTimeout(resolve, 15));
      // The editor autosaves a title change.
      await admin
        .from("site_pages")
        .update({ draft: { ...first.draft, title: "Renamed in the editor" } })
        .eq("id", id);
      const stale = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          ifRev: rev(first),
          type: "divider",
        },
        who(o),
      );
      expect(stale.error!.code).toBe("conflict");
      const stored = await subRow(id);
      expect(stored.draft.blocks).toHaveLength(0);
      expect(stored.draft.title).toBe("Renamed in the editor");
      // With the fresh rev the write goes through.
      const fresh = await rt.call(
        "add_block",
        { pageId: o.pageId, subPageId: id, ifRev: rev(stored), type: "divider" },
        who(o),
      );
      expect(fresh.isError, JSON.stringify(fresh.error)).toBe(false);
      expect((await subRow(id)).draft.title).toBe("Renamed in the editor");
    });

    it("updates, moves and removes blocks of the sub-page and never touches Home's blocks", async () => {
      const o = await owner("ab-ops");
      const id = await addSubPage(o, "items", {
        blocks: [linkBlock("blk-op-00001", "One"), linkBlock("blk-op-00002", "Two")],
      });
      const args = { pageId: o.pageId, subPageId: id };
      const upd = await rt.call(
        "update_block",
        { ...args, blockId: "blk-op-00001", fields: { label: "One renamed" } },
        who(o),
      );
      expect(upd.json!.block).toMatchObject({ label: "One renamed" });
      const again = await rt.call(
        "update_block",
        { ...args, blockId: "blk-op-00001", fields: { label: "One renamed" } },
        who(o),
      );
      expect(again.json!.unchanged).toBe(true);

      const mov = await rt.call(
        "move_block",
        { ...args, blockId: "blk-op-00002", position: "first" },
        who(o),
      );
      expect(mov.json!.order.map((item: any) => item.id)).toEqual(["blk-op-00002", "blk-op-00001"]);
      const rem = await rt.call("remove_block", { ...args, blockId: "blk-op-00002" }, who(o));
      expect(rem.json).toMatchObject({ removedBlockId: "blk-op-00002", blocksLeft: 1 });
      expect((await subRow(id)).draft.blocks.map((b: any) => b.label)).toEqual(["One renamed"]);

      // Home's block id does not exist on the sub-page.
      const wrong = await rt.call("remove_block", { ...args, blockId: "lnk-aaaaaaaa" }, who(o));
      expect(wrong.error!.code).toBe("block_not_found");
      expect((await homeRow(o)).draft.blocks).toHaveLength(1);
    });

    it("another account's sub-page is not_found for every block tool, and nothing is written", async () => {
      const mine = await owner("ab-nf-mine");
      const theirs = await owner("ab-nf-theirs");
      const foreign = await addSubPage(theirs, "secret", { blocks: [linkBlock("blk-foreign-1")] });
      const before = await subRow(foreign);
      const calls: Array<[string, Record<string, unknown>]> = [
        ["add_block", { type: "divider" }],
        ["update_block", { blockId: "blk-foreign-1", fields: { label: "Hijacked" } }],
        ["move_block", { blockId: "blk-foreign-1", position: "last" }],
        ["remove_block", { blockId: "blk-foreign-1" }],
        ["get_page", {}],
      ];
      for (const [name, rest] of calls) {
        const out = await rt.call(
          name,
          { pageId: mine.pageId, subPageId: foreign, ...rest },
          who(mine),
        );
        expect(out.error, name).toMatchObject({ code: "not_found", message: NOT_FOUND });
        // Naming the other account's SITE with their sub-page is the same answer.
        const viaTheirSite = await rt.call(
          name,
          { pageId: theirs.pageId, subPageId: foreign, ...rest },
          who(mine),
        );
        expect(viaTheirSite.error, name).toMatchObject({ code: "not_found", message: NOT_FOUND });
      }
      expect(await subRow(foreign)).toEqual(before);
    });

    it("the write tools need the write scope on a sub-page too", async () => {
      const o = await owner("ab-scope");
      const id = await addSubPage(o, "items");
      const out = await rt.call(
        "add_block",
        { pageId: o.pageId, subPageId: id, type: "divider" },
        who(o, ["hydlnk.read"]),
      );
      expect(out.error).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.write",
      });
    });

    it("a link to a blocked site on a sub-page is blocked_link, and the draft stays as it was", async () => {
      const o = await owner("ab-blocked");
      const id = await addSubPage(o, "items");
      const { data } = await admin.from("blocked_domains").select("domain").limit(1);
      if (!data || data.length === 0) return; // the blocklist is empty on this database
      const out = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          type: "link",
          fields: { label: "Bad", url: `https://${data[0]!.domain}/x` },
        },
        who(o),
      );
      expect(out.error!.code).toBe("blocked_link");
      expect((await subRow(id)).draft.blocks).toHaveLength(0);
    });

    it("a sub-page document at its size limit is too_large", async () => {
      const o = await owner("ab-large");
      const item = () => ({
        id: "x",
        name: "n".repeat(80),
        price: "p".repeat(20),
        description: "d".repeat(200),
        sold: false,
      });
      const itemsBlock = (n: number) => ({
        id: `blk-big-${String(n).padStart(4, "0")}`,
        type: "items",
        visible: true,
        layout: "list",
        items: Array.from({ length: 100 }, (_, i) => ({
          ...item(),
          id: `it-${String(n).padStart(3, "0")}-${String(i).padStart(3, "0")}`,
        })),
      });
      const id = await addSubPage(o, "big", { blocks: [1, 2, 3, 4, 5, 6].map(itemsBlock) });
      const out = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          type: "items",
          fields: {
            items: Array.from({ length: 100 }, (_, i) => ({
              name: "n".repeat(80),
              price: "p".repeat(20),
              description: "d".repeat(200),
              url: `https://example.com/${i}`,
            })),
          },
        },
        who(o),
      );
      expect(out.error!.code).toBe("too_large");
      expect((await subRow(id)).draft.blocks).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("page_link, items and hours blocks", () => {
    const itemsFields = {
      heading: "Garage sale",
      layout: "grid",
      items: [
        { name: "Lamp", price: "$5", description: "Works fine" },
        { name: "Chair", price: "Free", url: "https://example.com/chair", sold: true },
      ],
    };
    const week = (over: Record<string, unknown> = {}) => ({
      mon: { ranges: [{ open: "09:00", close: "17:00" }] },
      tue: { ranges: [{ open: "09:00", close: "17:00" }] },
      wed: {
        ranges: [
          { open: "09:00", close: "12:00" },
          { open: "13:00", close: "17:00" },
        ],
      },
      thu: { ranges: [{ open: "09:00", close: "17:00" }] },
      fri: { ranges: [{ open: "09:00", close: "17:00" }] },
      sat: { closed: true },
      sun: { closed: true },
      ...over,
    });

    it("add_block adds an items block with exactly what was given: no sample text, fresh item ids", async () => {
      const o = await owner("bl-items");
      const id = await addSubPage(o, "items");
      const out = await rt.call(
        "add_block",
        { pageId: o.pageId, subPageId: id, type: "items", fields: itemsFields },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const stored = (await subRow(id)).draft.blocks[0];
      expect(stored).toMatchObject({ type: "items", heading: "Garage sale", layout: "grid" });
      expect(stored.items).toHaveLength(2);
      expect(stored.items[0]).toMatchObject({
        name: "Lamp",
        price: "$5",
        description: "Works fine",
        sold: false,
      });
      expect(stored.items[1]).toMatchObject({
        name: "Chair",
        price: "Free",
        sold: true,
        url: "https://example.com/chair",
      });
      expect(stored.items[1].description).toBe("");
      expect(JSON.stringify(stored)).not.toMatch(/Sample item|Another item/);
      expect(new Set(stored.items.map((item: any) => item.id)).size).toBe(2);
      expect(out.json!.block.items[0]).toMatchObject({
        id: stored.items[0].id,
        name: "Lamp",
        sold: false,
      });
      // It also works on Home.
      const home = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "items", fields: itemsFields },
        who(o),
      );
      expect(home.isError, JSON.stringify(home.error)).toBe(false);
    });

    it("an items block needs items, a name per visible item, a valid layout and at most 100 items", async () => {
      const o = await owner("bl-items-bad");
      const id = await addSubPage(o, "items");
      const call = (fields: unknown, visible?: boolean) =>
        rt.call(
          "add_block",
          { pageId: o.pageId, subPageId: id, type: "items", fields, visible },
          who(o),
        );
      expect((await call({})).error!.code).toBe("invalid_input");
      expect((await call({ items: [{ price: "$1" }] })).error!.code).toBe("invalid_input");
      const layout = await call({ items: [{ name: "A" }], layout: "carousel" });
      expect(layout.error).toMatchObject({
        code: "invalid_input",
        message: "Choose list or grid.",
      });
      expect((await call({ items: [{ name: "A", price: "x".repeat(21) }] })).error!.code).toBe(
        "invalid_input",
      );
      expect((await call({ items: [{ name: "A", sold: "yes" }] })).error!.code).toBe(
        "invalid_input",
      );
      expect((await call({ items: [{ name: "A", colour: "red" }] })).error!.message).toContain(
        "Allowed: name, price",
      );
      expect(
        (await call({ items: Array.from({ length: 101 }, () => ({ name: "A" })) })).error!.code,
      ).toBe("invalid_input");
      expect((await call({ items: [{ name: "A", url: "javascript:alert(1)" }] })).error!.code).toBe(
        "invalid_input",
      );
      expect((await subRow(id)).draft.blocks).toHaveLength(0);
    });

    it("update_block on items keeps the ids of the items it is sent, drops the others, and sets Sold", async () => {
      const o = await owner("bl-items-upd");
      const id = await addSubPage(o, "items");
      const added = await rt.call(
        "add_block",
        { pageId: o.pageId, subPageId: id, type: "items", fields: itemsFields },
        who(o),
      );
      const [lamp, chair] = added.json!.block.items;
      const out = await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          subPageId: id,
          blockId: added.json!.blockId,
          fields: {
            heading: null,
            layout: "list",
            items: [{ id: chair.id, sold: false, price: "$9" }],
          },
        },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const stored = (await subRow(id)).draft.blocks[0];
      expect(stored.heading).toBeUndefined();
      expect(stored.layout).toBe("list");
      expect(stored.items).toHaveLength(1);
      expect(stored.items[0]).toMatchObject({
        id: chair.id,
        name: "Chair",
        price: "$9",
        sold: false,
      });
      expect(JSON.stringify(stored)).not.toContain(lamp.id);
      const foreign = await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          subPageId: id,
          blockId: added.json!.blockId,
          fields: { items: [{ id: "someone-elses-item", name: "X" }] },
        },
        who(o),
      );
      expect(foreign.error!.code).toBe("invalid_input");
    });

    it("an item's photo is an image already on the account's pages, found even when only a sub-page holds it", async () => {
      const o = await owner("bl-items-img");
      const other = await owner("bl-items-img-other");
      const ref = (userId: string, name: string) => ({
        path: `${userId}/${name}`,
        width: 400,
        height: 300,
      });
      await addSubPage(o, "gallery", {
        blocks: [
          {
            id: "blk-img-0001",
            type: "image",
            visible: true,
            image: ref(o.userId, "subphoto0001.webp"),
            alt: "A photo",
          },
        ],
      });
      await addSubPage(other, "gallery", {
        blocks: [
          {
            id: "blk-img-0002",
            type: "image",
            visible: true,
            image: ref(other.userId, "theirphoto01.webp"),
            alt: "Not mine",
          },
        ],
      });
      const target = await addSubPage(o, "items");
      const ok = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: target,
          type: "items",
          fields: { items: [{ name: "Vase", image: "subphoto0001.webp" }] },
        },
        who(o),
      );
      expect(ok.isError, JSON.stringify(ok.error)).toBe(false);
      expect(ok.json!.block.items[0].image).toEqual({
        imageId: "subphoto0001.webp",
        width: 400,
        height: 300,
      });
      const stored = (await subRow(target)).draft.blocks[0].items[0].image;
      expect(stored).toEqual(ref(o.userId, "subphoto0001.webp"));
      // Another account's image id is not an image of this account.
      const theirs = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: target,
          type: "items",
          fields: { items: [{ name: "Stolen", image: "theirphoto01.webp" }] },
        },
        who(o),
      );
      expect(theirs.error!.code).toBe("image_not_found");
      // And a URL is not an image.
      const url = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: target,
          type: "items",
          fields: { items: [{ name: "Web", image: "https://example.com/a.png" }] },
        },
        who(o),
      );
      expect(url.error!.code).toBe("invalid_input");
    });

    it("add_block adds hours: every day given, ranges as HH:MM, a closed day empty; get_page shows them", async () => {
      const o = await owner("bl-hours");
      const id = await addSubPage(o, "visit");
      const out = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          type: "hours",
          fields: { timezone: "America/Chicago", days: week(), note: "Closed on holidays" },
        },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const stored = (await subRow(id)).draft.blocks[0];
      expect(stored).toMatchObject({
        type: "hours",
        timezone: "America/Chicago",
        note: "Closed on holidays",
      });
      expect(stored.days.wed).toEqual({
        closed: false,
        ranges: [
          { open: "09:00", close: "12:00" },
          { open: "13:00", close: "17:00" },
        ],
      });
      expect(stored.days.sat).toEqual({ closed: true, ranges: [] });
      const read = await rt.call("get_page", { pageId: o.pageId, subPageId: id }, who(o));
      expect(read.json!.blocks[0]).toMatchObject({ type: "hours", timezone: "America/Chicago" });
      expect(read.json!.publishIssues).toEqual([]);
    });

    it("hours refuses a time zone off the list (and lists them), a missing day, a closed day with ranges and a bad time", async () => {
      const o = await owner("bl-hours-bad");
      const id = await addSubPage(o, "visit");
      const call = (fields: unknown) =>
        rt.call("add_block", { pageId: o.pageId, subPageId: id, type: "hours", fields }, who(o));
      const zone = await call({ timezone: "Mars/Olympus", days: week() });
      expect(zone.error!.code).toBe("invalid_input");
      expect(zone.error!.message).toContain("America/Chicago");
      const { mon: _mon, ...missing } = week();
      void _mon;
      expect((await call({ timezone: "UTC", days: missing })).error!.code).toBe("invalid_input");
      expect((await call({ timezone: "UTC" })).error!.code).toBe("invalid_input");
      const both = await call({
        timezone: "UTC",
        days: week({ sat: { closed: true, ranges: [{ open: "09:00", close: "10:00" }] } }),
      });
      expect(both.error).toMatchObject({ code: "invalid_input" });
      expect(both.error!.message).toContain("closed day takes no ranges");
      const empty = await call({ timezone: "UTC", days: week({ sat: {} }) });
      expect(empty.error!.code).toBe("invalid_input");
      const time = await call({
        timezone: "UTC",
        days: week({ mon: { ranges: [{ open: "9am", close: "5pm" }] } }),
      });
      expect(time.error!.code).toBe("invalid_input");
      const same = await call({
        timezone: "UTC",
        days: week({ mon: { ranges: [{ open: "09:00", close: "09:00" }] } }),
      });
      expect(same.error!.code).toBe("invalid_input");
      const three = await call({
        timezone: "UTC",
        days: week({
          mon: { ranges: [1, 2, 3].map((n) => ({ open: `0${n}:00`, close: `0${n}:30` })) },
        }),
      });
      expect(three.error!.code).toBe("invalid_input");
      expect((await subRow(id)).draft.blocks).toHaveLength(0);
    });

    it("update_block on hours changes only the days it names and clears the note with null", async () => {
      const o = await owner("bl-hours-upd");
      const id = await addSubPage(o, "visit");
      const added = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          type: "hours",
          fields: { timezone: "UTC", days: week(), note: "A note" },
        },
        who(o),
      );
      const out = await rt.call(
        "update_block",
        {
          pageId: o.pageId,
          subPageId: id,
          blockId: added.json!.blockId,
          fields: {
            timezone: "Europe/London",
            days: { sat: { ranges: [{ open: "10:00", close: "14:00" }] } },
            note: null,
          },
        },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const stored = (await subRow(id)).draft.blocks[0];
      expect(stored.timezone).toBe("Europe/London");
      expect(stored.note).toBeUndefined();
      expect(stored.days.sat).toEqual({
        closed: false,
        ranges: [{ open: "10:00", close: "14:00" }],
      });
      expect(stored.days.mon.ranges).toEqual([{ open: "09:00", close: "17:00" }]);
      expect(stored.days.sun).toEqual({ closed: true, ranges: [] });
    });

    it("add_block adds a page_link to Home or to a page of this site and nowhere else", async () => {
      const o = await owner("bl-link");
      const theirs = await owner("bl-link-theirs");
      const items = await addSubPage(o, "items");
      const foreign = await addSubPage(theirs, "secret");
      const add = (target: string, extra: Record<string, unknown> = {}) =>
        rt.call(
          "add_block",
          {
            pageId: o.pageId,
            type: "page_link",
            fields: { label: "See the sale", target },
            ...extra,
          },
          who(o),
        );
      const ok = await add(items);
      expect(ok.isError, JSON.stringify(ok.error)).toBe(false);
      expect(ok.json!.block).toMatchObject({
        type: "page_link",
        label: "See the sale",
        target: items,
      });
      const home = await add("HOME");
      expect(home.json!.block.target).toBe("home");
      const upper = await add(items.toUpperCase());
      expect(upper.json!.block.target).toBe(items);
      for (const target of [foreign, "11111111-1111-4111-8111-111111111111", "items", ""]) {
        const out = await add(target);
        expect(out.error, target).toMatchObject({ code: "invalid_input" });
        expect(out.error!.message).toContain("home or the id of a page of this site");
      }
      // On a sub-page, linking back to Home.
      const back = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: items,
          type: "page_link",
          fields: { label: "Back", target: "home" },
        },
        who(o),
      );
      expect(back.isError, JSON.stringify(back.error)).toBe(false);
      // Both fields are needed.
      const none = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "page_link", fields: { label: "x" } },
        who(o),
      );
      expect(none.error!.code).toBe("invalid_input");
    });

    it("update_block can retarget a page_link, again only within the site", async () => {
      const o = await owner("bl-link-upd");
      const theirs = await owner("bl-link-upd-theirs");
      const a = await addSubPage(o, "a");
      const foreign = await addSubPage(theirs, "secret");
      const added = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "page_link", fields: { label: "Go", target: "home" } },
        who(o),
      );
      const ok = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: added.json!.blockId, fields: { target: a } },
        who(o),
      );
      expect(ok.json!.block.target).toBe(a);
      const bad = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: added.json!.blockId, fields: { target: foreign } },
        who(o),
      );
      expect(bad.error!.code).toBe("invalid_input");
      const label = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: added.json!.blockId, fields: { label: "Go now" } },
        who(o),
      );
      expect(label.json!.block).toMatchObject({ label: "Go now", target: a });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("create_page", () => {
    it("adds an empty draft page with the title and a path made from it, and puts it in the menu", async () => {
      const o = await owner("cp-basic");
      const homeBefore = await homeRow(o);
      const out = await rt.call("create_page", { pageId: o.pageId, title: "Our Story" }, who(o));
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({ title: "Our Story", path: "/our-story", inMenu: true });
      const row = await subRow(out.json!.subPageId);
      expect(row.page_id).toBe(o.pageId);
      expect(row.draft).toEqual({
        path: "our-story",
        title: "Our Story",
        description: "",
        blocks: [],
      });
      expect(row.published).toBeNull();
      expect(out.json!.rev).toBe(rev(row));
      const home = await homeRow(o);
      expect(home.draft.nav).toEqual({ show: true, items: [row.id] });
      expect(home.draft.rev).toBe(homeBefore.draft.rev + 1);
      expect(out.json!.homeRev).toBe(home.draft.rev);
      expect(home.published_at).toBeNull();
    });

    it("takes the path it is given, and inMenu false keeps Home's draft untouched", async () => {
      const o = await owner("cp-path");
      const homeBefore = await homeRow(o);
      const out = await rt.call(
        "create_page",
        { pageId: o.pageId, title: "Directions", path: "find-us", inMenu: false },
        who(o),
      );
      expect(out.json).toMatchObject({ path: "/find-us", inMenu: false });
      expect(out.json!.homeRev).toBeUndefined();
      expect(await homeRow(o)).toEqual(homeBefore);
    });

    it.each([
      ["a reserved path", { title: "A", path: "api" }, "path"],
      ["an hl- path", { title: "A", path: "hl-x" }, "path"],
      ["upper case", { title: "A", path: "Items" }, "path"],
      ["a slash", { title: "A", path: "a/b" }, "path"],
      ["an empty title", { title: "   " }, "title"],
      ["a 61-character title", { title: "t".repeat(61) }, "title"],
    ])("%s is invalid_input and creates nothing", async (_label, input, field) => {
      const o = await owner("cp-bad");
      const out = await rt.call("create_page", { pageId: o.pageId, ...input }, who(o));
      expect(out.error!.code).toBe("invalid_input");
      expect(out.error!.issues![0]!.path).toBe(field);
      const { count } = await admin
        .from("site_pages")
        .select("id", { count: "exact", head: true })
        .eq("page_id", o.pageId);
      expect(count).toBe(0);
    });

    it("a path another page of the site uses, as a draft or live, is invalid_input", async () => {
      const o = await owner("cp-taken");
      await addSubPage(o, "items");
      const live = await addSubPage(o, "shop");
      await admin
        .from("site_pages")
        .update({
          draft: { path: "store", title: "Store", description: "", blocks: [] },
          published: { path: "shop", title: "Shop", description: "", blocks: [] },
          published_at: new Date().toISOString(),
        })
        .eq("id", live);
      for (const path of ["items", "shop", "store"]) {
        const out = await rt.call("create_page", { pageId: o.pageId, title: "Dup", path }, who(o));
        expect(out.error, path).toMatchObject({ code: "invalid_input" });
        expect(out.error!.message).toMatch(/already uses that path|another page/i);
      }
    });

    it("the pages-per-site limit is plan_required, with the plan's own words", async () => {
      const free = await owner("cp-limit-free", "free");
      for (const title of ["One", "Two"]) {
        const ok = await rt.call("create_page", { pageId: free.pageId, title }, who(free));
        expect(ok.isError, JSON.stringify(ok.error)).toBe(false);
      }
      const refused = await rt.call(
        "create_page",
        { pageId: free.pageId, title: "Three" },
        who(free),
      );
      expect(refused.error!.code).toBe("plan_required");
      expect(refused.error!.message).toMatch(/pages|limit/i);
      const { count } = await admin
        .from("site_pages")
        .select("id", { count: "exact", head: true })
        .eq("page_id", free.pageId);
      expect(count).toBe(2);
      // Pro has room for more.
      const pro = await owner("cp-limit-pro", "pro");
      for (let i = 0; i < 9; i++) {
        const ok = await rt.call(
          "create_page",
          { pageId: pro.pageId, title: `P${i}`, inMenu: false },
          who(pro),
        );
        expect(ok.isError, `${i}: ${JSON.stringify(ok.error)}`).toBe(false);
      }
      const tenth = await rt.call("create_page", { pageId: pro.pageId, title: "Tenth" }, who(pro));
      expect(tenth.error!.code).toBe("plan_required");
    });

    it("a full menu leaves the page created and out of the menu, and says so", async () => {
      const o = await owner("cp-menu-full", "studio");
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push(await addSubPage(o, `m${i}`));
      const home = await homeRow(o);
      await admin
        .from("pages")
        .update({ draft: { ...home.draft, nav: { show: true, items: ids } } })
        .eq("id", o.pageId);
      const out = await rt.call("create_page", { pageId: o.pageId, title: "Twenty-one" }, who(o));
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json!.inMenu).toBe(false);
      expect(out.json!.menuNote).toContain("menu is full");
      expect((await homeRow(o)).draft.nav.items).toHaveLength(20);
    });

    it("another account's site is not_found and nothing is created", async () => {
      const mine = await owner("cp-nf-mine");
      const theirs = await owner("cp-nf-theirs");
      for (const pageId of [theirs.pageId, "11111111-1111-4111-8111-111111111111", "nope"]) {
        const out = await rt.call("create_page", { pageId, title: "Hijack" }, who(mine));
        expect(out.error, pageId).toMatchObject({ code: "not_found", message: NOT_FOUND });
      }
      const { count } = await admin
        .from("site_pages")
        .select("id", { count: "exact", head: true })
        .eq("page_id", theirs.pageId);
      expect(count).toBe(0);
    });

    it("needs the write scope, and a suspended account is refused before anything is written", async () => {
      const o = await owner("cp-scope");
      const read = await rt.call(
        "create_page",
        { pageId: o.pageId, title: "X" },
        who(o, ["hydlnk.read"]),
      );
      expect(read.error).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.write",
      });
      await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", o.userId);
      const out = await rt.call("create_page", { pageId: o.pageId, title: "X" }, who(o));
      expect(out.error!.code).toBe("account_suspended");
      const { count } = await admin
        .from("site_pages")
        .select("id", { count: "exact", head: true })
        .eq("page_id", o.pageId);
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("update_page_settings", () => {
    it("changes the title, description and path in one write, keeping the blocks", async () => {
      const o = await owner("us-fields");
      const id = await addSubPage(o, "items", { blocks: [linkBlock("blk-us-00001")] });
      const before = await subRow(id);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const out = await rt.call(
        "update_page_settings",
        {
          pageId: o.pageId,
          subPageId: id,
          ifRev: rev(before),
          title: "Shop",
          description: "What is for sale",
          path: "shop",
        },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({
        title: "Shop",
        description: "What is for sale",
        path: "/shop",
        unchanged: false,
      });
      const after = await subRow(id);
      expect(after.draft).toEqual({
        path: "shop",
        title: "Shop",
        description: "What is for sale",
        blocks: before.draft.blocks,
      });
      expect(out.json!.rev).toBe(rev(after));
      // The same values again change nothing.
      const again = await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: id, title: "Shop", path: "shop" },
        who(o),
      );
      expect(again.json!.unchanged).toBe(true);
      expect(rev(await subRow(id))).toBe(rev(after));
    });

    it("refuses a path another page uses (draft or live), a reserved one and a badly shaped one", async () => {
      const o = await owner("us-path");
      const id = await addSubPage(o, "items");
      await addSubPage(o, "visit");
      const live = await addSubPage(o, "old");
      await admin
        .from("site_pages")
        .update({
          draft: { path: "renamed", title: "R", description: "", blocks: [] },
          published: { path: "old", title: "R", description: "", blocks: [] },
          published_at: new Date().toISOString(),
        })
        .eq("id", live);
      for (const path of [
        "visit",
        "old",
        "renamed",
        "og",
        "r",
        "sitemap",
        "hl-1",
        "Has Caps",
        "a_b",
        "-x",
        "",
      ]) {
        const out = await rt.call(
          "update_page_settings",
          { pageId: o.pageId, subPageId: id, path },
          who(o),
        );
        expect(out.error, path).toMatchObject({ code: "invalid_input" });
      }
      // Its own path is not "taken": keeping it, or taking back a path it holds live, is fine.
      const own = await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: id, path: "items" },
        who(o),
      );
      expect(own.isError, JSON.stringify(own.error)).toBe(false);
      expect((await subRow(id)).draft.path).toBe("items");
    });

    it("refuses a long title or description and an empty title", async () => {
      const o = await owner("us-text");
      const id = await addSubPage(o, "items");
      const call = (extra: Record<string, unknown>) =>
        rt.call("update_page_settings", { pageId: o.pageId, subPageId: id, ...extra }, who(o));
      expect((await call({ title: "t".repeat(61) })).error!.code).toBe("invalid_input");
      expect((await call({ title: "  " })).error!.code).toBe("invalid_input");
      expect((await call({ description: "d".repeat(161) })).error!.code).toBe("invalid_input");
      expect((await call({})).error!.code).toBe("invalid_input");
      const clear = await call({ description: "" });
      expect(clear.isError).toBe(false);
    });

    it("adds a page to the menu at a position, moves it and takes it out; Home's rev moves with each change", async () => {
      const o = await owner("us-menu");
      const a = await addSubPage(o, "a");
      const b = await addSubPage(o, "b");
      const c = await addSubPage(o, "c");
      const menu = async () => (await homeRow(o)).draft;
      const set = (id: string, extra: Record<string, unknown>) =>
        rt.call("update_page_settings", { pageId: o.pageId, subPageId: id, ...extra }, who(o));

      const r0 = (await menu()).rev;
      const first = await set(a, { inMenu: true });
      expect(first.json).toMatchObject({ inMenu: true, menuPosition: 0, homeRev: r0 + 1 });
      await set(b, { inMenu: true });
      const front = await set(c, { inMenu: true, menuPosition: 0 });
      expect(front.json).toMatchObject({ menuPosition: 0 });
      expect((await menu()).nav.items).toEqual([c, a, b]);
      const moved = await set(b, { menuPosition: 1 });
      expect(moved.json).toMatchObject({ inMenu: true, menuPosition: 1 });
      expect((await menu()).nav.items).toEqual([c, b, a]);
      const same = await set(b, { menuPosition: 1 });
      expect(same.json!.unchanged).toBe(true);
      expect(same.json!.homeRev).toBeUndefined();
      const out = await set(c, { inMenu: false });
      expect(out.json).toMatchObject({ inMenu: false, menuPosition: null });
      expect((await menu()).nav.items).toEqual([b, a]);
      // A position past the end puts the page last.
      await set(c, { inMenu: true, menuPosition: 99 });
      expect((await menu()).nav.items).toEqual([b, a, c]);
      // The menu is Home's draft: the live page is untouched.
      expect((await homeRow(o)).published_at).toBeNull();
    });

    it("menuPosition for a page that is not in the menu, or with inMenu false, is invalid_input", async () => {
      const o = await owner("us-menu-bad");
      const a = await addSubPage(o, "a");
      const before = await homeRow(o);
      const notIn = await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: a, menuPosition: 0 },
        who(o),
      );
      expect(notIn.error!.code).toBe("invalid_input");
      const both = await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: a, inMenu: false, menuPosition: 0 },
        who(o),
      );
      expect(both.error!.code).toBe("invalid_input");
      expect(await homeRow(o)).toEqual(before);
    });

    it("a full menu refuses one more page and writes nothing, not even the title in the same call", async () => {
      const o = await owner("us-menu-full", "studio");
      const ids: string[] = [];
      for (let i = 0; i < 21; i++) ids.push(await addSubPage(o, `m${i}`));
      const home = await homeRow(o);
      await admin
        .from("pages")
        .update({ draft: { ...home.draft, nav: { show: true, items: ids.slice(0, 20) } } })
        .eq("id", o.pageId);
      const before = await subRow(ids[20]!);
      const out = await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: ids[20], inMenu: true, title: "Renamed" },
        who(o),
      );
      expect(out.error).toMatchObject({ code: "invalid_input" });
      expect(out.error!.message).toContain("menu is full");
      expect(await subRow(ids[20]!)).toEqual(before);
    });

    it("a stale ifRev is a conflict, also for a menu-only change", async () => {
      const o = await owner("us-conflict");
      const id = await addSubPage(o, "a");
      const first = await subRow(id);
      await new Promise((resolve) => setTimeout(resolve, 15));
      await admin
        .from("site_pages")
        .update({ draft: { ...first.draft, title: "Edited" } })
        .eq("id", id);
      const homeBefore = await homeRow(o);
      for (const extra of [{ title: "Mine" }, { inMenu: true }]) {
        const out = await rt.call(
          "update_page_settings",
          { pageId: o.pageId, subPageId: id, ifRev: rev(first), ...extra },
          who(o),
        );
        expect(out.error!.code).toBe("conflict");
      }
      expect((await subRow(id)).draft.title).toBe("Edited");
      expect(await homeRow(o)).toEqual(homeBefore);
    });

    it("Home is not a page to configure here, and another account's page is not_found", async () => {
      const mine = await owner("us-nf-mine");
      const theirs = await owner("us-nf-theirs");
      const foreign = await addSubPage(theirs, "secret", { title: "Their secret page" });
      const before = await subRow(foreign);
      const home = await rt.call(
        "update_page_settings",
        { pageId: mine.pageId, subPageId: "home", title: "X" },
        who(mine),
      );
      expect(home.error!.code).toBe("invalid_input");
      for (const [pageId, subPageId] of [
        [mine.pageId, foreign],
        [theirs.pageId, foreign],
        [mine.pageId, "11111111-1111-4111-8111-111111111111"],
        [mine.pageId, "x"],
      ]) {
        const out = await rt.call(
          "update_page_settings",
          { pageId, subPageId, title: "Hijack", inMenu: true },
          who(mine),
        );
        expect(out.error, `${pageId} ${subPageId}`).toMatchObject({
          code: "not_found",
          message: NOT_FOUND,
        });
      }
      expect(await subRow(foreign)).toEqual(before);
      expect((await homeRow(theirs)).draft.nav).toBeUndefined();
      const noScope = await rt.call(
        "update_page_settings",
        { pageId: mine.pageId, subPageId: foreign, title: "x" },
        who(mine, ["hydlnk.read"]),
      );
      expect(noScope.error!.code).toBe("insufficient_scope");
    });
  });

  // -------------------------------------------------------------------------------------------
  describe("the whole flow and the activity log", () => {
    it("create, fill, link, menu and publish the whole site; the activity log has the new tools and no content", async () => {
      const o = await owner("flow");
      const CANARY = `CANARY-${Math.random().toString(36).slice(2, 10)}`;
      const created = await rt.call(
        "create_page",
        { pageId: o.pageId, title: `Items ${CANARY}` },
        who(o),
      );
      const id = created.json!.subPageId as string;
      const added = await rt.call(
        "add_block",
        {
          pageId: o.pageId,
          subPageId: id,
          ifRev: created.json!.rev,
          type: "items",
          fields: { items: [{ name: `Lamp ${CANARY}`, price: "$5" }] },
        },
        who(o),
      );
      expect(added.isError, JSON.stringify(added.error)).toBe(false);
      const link = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "page_link", fields: { label: "Shop", target: id } },
        who(o),
      );
      expect(link.isError, JSON.stringify(link.error)).toBe(false);
      const settings = await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: id, description: `About ${CANARY}` },
        who(o),
      );
      expect(settings.isError, JSON.stringify(settings.error)).toBe(false);

      const list = await rt.call("list_pages", {}, who(o));
      expect(list.json!.pages[0].pages.map((page: any) => [page.id, page.live])).toEqual([
        ["home", false],
        [id, false],
      ]);
      const published = await rt.call("publish_page", { pageId: o.pageId }, who(o));
      expect(published.isError, JSON.stringify(published.error)).toBe(false);
      const live = await subRow(id);
      expect(live.published_at).not.toBeNull();
      expect(live.published.blocks[0].items[0].name).toBe(`Lamp ${CANARY}`);
      expect(live.live_path).toBe(live.draft.path);
      const after = await rt.call("list_pages", {}, who(o));
      expect(after.json!.pages[0].pages[1]).toMatchObject({ id, live: true, inMenu: true });
      const status = await rt.call("get_page", { pageId: o.pageId, subPageId: id }, who(o));
      expect(status.json!.page).toMatchObject({ publishStatus: "published", live: true });

      await rt.flush();
      const rows = (
        await admin.from("mcp_activity").select("*").eq("user_id", o.userId).order("id")
      ).data!;
      expect(rows.map((row: any) => row.tool)).toEqual([
        "create_page",
        "add_block",
        "add_block",
        "update_page_settings",
        "list_pages",
        "publish_page",
        "list_pages",
        "get_page",
      ]);
      expect(rows.every((row: any) => row.ok === true && row.error_code === null)).toBe(true);
      expect(
        rows.every((row: any) => row.page_id === (row.tool === "list_pages" ? null : o.pageId)),
      ).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(CANARY);
    });

    it("publish_page names the sub-page that blocks the publish", async () => {
      const o = await owner("flow-refused");
      const id = await addSubPage(o, "items", {
        title: "Broken page",
        blocks: [{ id: "blk-bad-0002", type: "link", visible: true, label: "", url: "" }],
      });
      const out = await rt.call("publish_page", { pageId: o.pageId }, who(o));
      expect(out.error!.code).toBe("publish_refused");
      expect(JSON.stringify(out.error)).toContain("Broken page");
      expect((await subRow(id)).published_at).toBeNull();
    });

    it("a refused call is recorded with its code and still holds no content", async () => {
      const o = await owner("flow-activity");
      await rt.call(
        "create_page",
        { pageId: o.pageId, title: "Secret title", path: "api" },
        who(o),
      );
      await rt.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: "x", title: "Secret too" },
        who(o),
      );
      await rt.flush();
      const rows = (
        await admin.from("mcp_activity").select("*").eq("user_id", o.userId).order("id")
      ).data!;
      expect(rows.map((row: any) => [row.tool, row.ok, row.error_code])).toEqual([
        ["create_page", false, "invalid_input"],
        ["update_page_settings", false, "not_found"],
      ]);
      expect(JSON.stringify(rows)).not.toMatch(/Secret/);
    });
  });
});

export type { Outcome };
