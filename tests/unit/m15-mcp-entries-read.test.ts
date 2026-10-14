/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminForTests, makeRuntime } from "./support/mcp-db";
import { richDraft } from "./support/mcp-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * 1b1-20 (M15-05) against the local database: the MCP page access and read tools on page entries.
 * Sub-pages are the non-Home `page` entries of the owner's site, Home's blocks and rev come from the
 * '/' entry, and Home's entry id means Home and is never printed.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("the MCP read tools on page entries (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  const owners: TestOwner[] = [];

  async function movedOwner(label: string) {
    const made = await makeOwner(admin, label, undefined, "pro");
    const { error } = await admin
      .from("pages")
      .update({ draft: richDraft(made.handle, made.userId, 3) as never })
      .eq("id", made.pageId);
    if (error) throw new Error(error.message);
    owners.push(made);
    const homeId = await moveHome(admin, made.pageId);
    return { ...made, homeId };
  }
  async function subPage(o: TestOwner, path: string, title: string, over: object = {}) {
    const type = await admin
      .from("content_types")
      .select("id")
      .eq("site_id", o.pageId)
      .eq("key", "page")
      .single();
    const made = await admin
      .from("content_entries")
      .insert({
        site_id: o.pageId,
        type_id: type.data!.id,
        draft: {
          path,
          title,
          description: "",
          blocks: [{ id: `hdr-${path}-0001`, type: "header", visible: true, text: title }],
          ...over,
        } as never,
      })
      .select("id, rev")
      .single();
    if (made.error) throw new Error(made.error.message);
    return { id: made.data.id as string, rev: Number(made.data.rev) };
  }
  const who = (o: TestOwner) => ({ userId: o.userId });

  beforeAll(async () => {
    admin = adminForTests();
    rt = await makeRuntime(admin);
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("list_pages lists the sub-page entries with Home first, and never prints Home's entry id", async () => {
    const o = await movedOwner("e20-list");
    const a = await subPage(o, "items", "Items");
    const b = await subPage(o, "visit", "Visit");
    const home = (await admin.from("pages").select("draft").eq("id", o.pageId).single()).data!
      .draft as any;
    await admin
      .from("pages")
      .update({ draft: { ...home, nav: { show: true, items: [b.id] } } })
      .eq("id", o.pageId);

    const out = await rt.call("list_pages", {}, who(o));
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    const site = out.json!.pages[0];
    expect(site.pageCount).toBe(3);
    expect(site.pages.map((p: any) => [p.id, p.title, p.path, p.inMenu, p.live])).toEqual([
      ["home", "Home", "/", true, false],
      [b.id, "Visit", "/visit", true, false],
      [a.id, "Items", "/items", false, false],
    ]);
    expect(JSON.stringify(out.json)).not.toContain(o.homeId);
  });

  it("list_pages does not list a trashed page, or another owner's pages", async () => {
    const o = await movedOwner("e20-trash");
    const other = await movedOwner("e20-trash-other");
    const gone = await subPage(o, "gone", "Gone");
    await subPage(other, "theirs", "Theirs");
    await admin
      .from("content_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", gone.id);
    const out = await rt.call("list_pages", {}, who(o));
    expect(out.json!.pages[0].pageCount).toBe(1);
    expect(JSON.stringify(out.json)).not.toContain("Theirs");
  });

  it("get_page on Home reads the blocks of the '/' entry and reports its rev beside the design rev", async () => {
    const o = await movedOwner("e20-home");
    await admin
      .from("content_entries")
      .update({
        draft: {
          path: "/",
          title: "",
          description: "",
          blocks: [{ id: "hdr-entry-001", type: "header", visible: true, text: "From the entry" }],
        } as never,
      })
      .eq("id", o.homeId);
    const entry = (await admin.from("content_entries").select("rev").eq("id", o.homeId).single())
      .data!;
    const out = await rt.call("get_page", { pageId: o.pageId }, who(o));
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    expect(out.json!.blocks).toHaveLength(1);
    expect(out.json!.blocks[0].id).toBe("hdr-entry-001");
    expect(out.json!.page.rev).toBe(Number(entry.rev));
    expect(typeof out.json!.page.designRev).toBe("number");
    expect(JSON.stringify(out.json)).not.toContain(o.homeId);
  });

  it("get_page with a sub-page id reads that entry, and its rev is the entry rev", async () => {
    const o = await movedOwner("e20-sub");
    const a = await subPage(o, "about", "About us");
    const out = await rt.call("get_page", { pageId: o.pageId, subPageId: a.id }, who(o));
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    expect(out.json!.page).toMatchObject({ subPageId: a.id, title: "About us", rev: a.rev });
    expect(out.json!.blocks[0].id).toBe("hdr-about-0001");
    // The page's id alone works as pageId too.
    const alone = await rt.call("get_page", { pageId: a.id }, who(o));
    expect(alone.isError, JSON.stringify(alone.error)).toBe(false);
    expect(alone.json!.page.subPageId).toBe(a.id);
  });

  it("Home's entry id as pageId or as subPageId means Home", async () => {
    const o = await movedOwner("e20-homeid");
    const asPage = await rt.call("get_page", { pageId: o.homeId }, who(o));
    expect(asPage.isError, JSON.stringify(asPage.error)).toBe(false);
    expect(asPage.json!.page.id).toBe(o.pageId);
    expect(asPage.json!.page.subPageId).toBeUndefined();
    const asSub = await rt.call("get_page", { pageId: o.pageId, subPageId: o.homeId }, who(o));
    expect(asSub.isError, JSON.stringify(asSub.error)).toBe(false);
    expect(asSub.json!.page.id).toBe(o.pageId);
    expect(asSub.json!.page.subPageId).toBeUndefined();
    expect(JSON.stringify(asSub.json)).not.toContain(o.homeId);
  });

  it("another owner's entry id, a trashed page and a random id are one not-found", async () => {
    const o = await movedOwner("e20-nf");
    const other = await movedOwner("e20-nf-other");
    const theirs = await subPage(other, "theirs", "Theirs");
    const mine = await subPage(o, "mine", "Mine");
    await admin
      .from("content_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", mine.id);
    const calls = [
      { pageId: theirs.id },
      { pageId: other.homeId },
      { pageId: o.pageId, subPageId: theirs.id },
      { pageId: o.pageId, subPageId: other.homeId },
      { pageId: o.pageId, subPageId: mine.id },
      { pageId: o.pageId, subPageId: "00000000-0000-4000-8000-000000000000" },
    ];
    for (const args of calls) {
      const out = await rt.call("get_page", args, who(o));
      expect(out.isError, JSON.stringify(args)).toBe(true);
      expect(out.error!.code, JSON.stringify(args)).toBe("not_found");
    }
  });

  it("create_page makes an entry and answers its rev; a block write with that rev works", async () => {
    const o = await movedOwner("e20-create");
    const made = await rt.call("create_page", { pageId: o.pageId, title: "Shop" }, { ...who(o) });
    expect(made.isError, JSON.stringify(made.error)).toBe(false);
    const id = made.json!.subPageId as string;
    const entry = (await admin.from("content_entries").select("rev, draft").eq("id", id).single())
      .data as any;
    expect(made.json!.rev).toBe(Number(entry.rev));
    expect(entry.draft.path).toBe("shop");
    const added = await rt.call(
      "add_block",
      {
        pageId: o.pageId,
        subPageId: id,
        type: "header",
        fields: { text: "Hi" },
        ifRev: made.json!.rev,
      },
      who(o),
    );
    expect(added.isError, JSON.stringify(added.error)).toBe(false);
  });
});
