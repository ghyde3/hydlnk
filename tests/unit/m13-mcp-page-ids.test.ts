/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOf as publishableDraft, makeOwner, removeOwners, stackIsUp } from "./publish-support";
import type { TestOwner } from "./publish-support";
import { adminForTests, makeRuntime } from "./support/mcp-db";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M13-14: a page id from list_pages sent as `pageId` (an AI app with a stale tool list) resolves to
 * that sub-page for the page tools and to its site for the site-level tools. Every miss (another
 * account, a deleted page, a random id) is the one `not_found`. Skipped when the stack is not up.
 */
const { run } = await stackIsUp();

const NOT_FOUND = "We couldn’t find that page. Call list_pages to see your pages.";

describe.skipIf(!run)("a page id as pageId (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  const owners: TestOwner[] = [];

  async function owner(label: string) {
    const made = await makeOwner(admin, label, (handle) => publishableDraft(handle), "pro");
    owners.push(made);
    return made;
  }
  const who = (o: TestOwner) => ({ userId: o.userId });
  async function addSubPage(o: TestOwner, path: string, blocks: unknown[] = []): Promise<string> {
    const draft = { path, title: `Page ${path}`, description: "", blocks };
    const { data, error } = await admin
      .from("site_pages")
      .insert({ page_id: o.pageId, draft: draft as never })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const subRow = async (id: string) =>
    (await admin.from("site_pages").select("*").eq("id", id).single()).data as any;
  const homeRow = async (o: TestOwner) =>
    (await admin.from("pages").select("draft").eq("id", o.pageId).single()).data as any;
  const linkBlock = (id: string, label: string) => ({
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

  it("add_block, get_page, update_block, move_block and remove_block act on the sub-page", async () => {
    const o = await owner("pid-blocks");
    const id = await addSubPage(o, "services", [
      linkBlock("blk-pid-00001", "One"),
      linkBlock("blk-pid-00002", "Two"),
    ]);
    const homeBefore = (await homeRow(o)).draft.blocks.length;

    const added = await rt.call(
      "add_block",
      {
        pageId: id,
        type: "link",
        fields: { label: "Google", url: "https://google.com" },
      },
      who(o),
    );
    expect(added.isError, JSON.stringify(added.error)).toBe(false);
    expect((await subRow(id)).draft.blocks.map((b: any) => b.label)).toEqual([
      "One",
      "Two",
      "Google",
    ]);
    expect((await homeRow(o)).draft.blocks).toHaveLength(homeBefore);

    const read = await rt.call("get_page", { pageId: id }, who(o));
    expect(read.isError, JSON.stringify(read.error)).toBe(false);
    expect(read.json!.page).toMatchObject({ id: o.pageId, subPageId: id });
    expect(read.json!.blocks).toHaveLength(3);

    const upd = await rt.call(
      "update_block",
      { pageId: id, blockId: "blk-pid-00001", fields: { label: "Renamed" } },
      who(o),
    );
    expect(upd.json!.block).toMatchObject({ label: "Renamed" });
    const mov = await rt.call(
      "move_block",
      { pageId: id, blockId: "blk-pid-00002", position: "first" },
      who(o),
    );
    expect(mov.json!.order[0].id).toBe("blk-pid-00002");
    const rem = await rt.call("remove_block", { pageId: id, blockId: "blk-pid-00002" }, who(o));
    expect(rem.json).toMatchObject({ removedBlockId: "blk-pid-00002", blocksLeft: 2 });
    expect((await homeRow(o)).draft.blocks).toHaveLength(homeBefore);
  });

  it("a site-level tool acts on the site of the sub-page, and the activity row names the site", async () => {
    const o = await owner("pid-site");
    const id = await addSubPage(o, "services");
    const out = await rt.call("create_preview_link", { pageId: id }, who(o));
    expect(out.isError, JSON.stringify(out.error)).toBe(false);
    const theme = await rt.call("get_analytics", { pageId: id }, who(o));
    expect(theme.isError, JSON.stringify(theme.error)).toBe(false);
    const profile = await rt.call("update_profile", { pageId: id, name: "Via page id" }, who(o));
    expect(profile.isError, JSON.stringify(profile.error)).toBe(false);
    expect((await homeRow(o)).draft.profile.name).toBe("Via page id");
    await rt.flush();
    const mine = rt.activity.filter((row) => row.userId === o.userId);
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) expect(row.pageId).toBe(o.pageId);
  });

  it("another account's page, a deleted page and a random id are the same not_found", async () => {
    const mine = await owner("pid-mine");
    const theirs = await owner("pid-theirs");
    const foreign = await addSubPage(theirs, "secret", [linkBlock("blk-pid-foreign", "Secret")]);
    const gone = await addSubPage(mine, "gone");
    await admin.from("site_pages").delete().eq("id", gone);
    const answers: unknown[] = [];
    for (const pageId of [foreign, gone, "0b1c2d3e-0000-4000-8000-000000000000", "not-a-uuid"]) {
      for (const [tool, args] of [
        ["add_block", { type: "link", fields: { label: "X", url: "https://example.com" } }],
        ["get_page", {}],
        ["publish_page", {}],
        ["create_preview_link", {}],
      ] as const) {
        const out = await rt.call(tool, { pageId, ...args }, who(mine));
        expect(out.error!.code).toBe("not_found");
        expect(out.error!.message).toBe(NOT_FOUND);
        answers.push([out.error!.code, out.error!.message]);
      }
    }
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect((await subRow(foreign)).draft.blocks).toHaveLength(1);
  });

  it("a subPageId that names a different page than the resolved one is invalid_input", async () => {
    const o = await owner("pid-contra");
    const a = await addSubPage(o, "alpha");
    const b = await addSubPage(o, "beta");
    for (const subPageId of [b, "home"]) {
      const out = await rt.call(
        "add_block",
        { pageId: a, subPageId, type: "link", fields: { label: "X", url: "https://example.com" } },
        who(o),
      );
      expect(out.error!.code).toBe("invalid_input");
      expect(out.error!.message).toMatch(/pageId/);
    }
    expect((await subRow(a)).draft.blocks).toHaveLength(0);
    // The same page named twice is fine.
    const ok = await rt.call(
      "add_block",
      { pageId: a, subPageId: a, type: "link", fields: { label: "X", url: "https://example.com" } },
      who(o),
    );
    expect(ok.isError, JSON.stringify(ok.error)).toBe(false);
  });

  it("list_pages gives each page an explicit target", async () => {
    const o = await owner("pid-list");
    const id = await addSubPage(o, "services");
    const out = await rt.call("list_pages", {}, who(o));
    const pages = out.json!.pages[0].pages;
    expect(pages[0].target).toEqual({ pageId: o.pageId });
    expect(pages.find((p: any) => p.id === id).target).toEqual({ pageId: o.pageId, subPageId: id });
  });
});
