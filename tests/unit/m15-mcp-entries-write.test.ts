/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftDocSchema } from "@/lib/document";
import { makeOwner, moveHome, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminForTests, makeRuntime } from "./support/mcp-db";
import { richDraft } from "./support/mcp-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * 1b1-19 (M15-05) against the local database: the MCP draft writer on page entries. On a moved site
 * Home's blocks and every sub-page are entries (written through the content writer, guarded by the
 * entry's rev), the design is `pages.draft` with its blocks frozen, and each tool's `ifRev` and
 * returned rev are those of the document it writes.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("the MCP draft writer on page entries (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  let writeDraft: typeof import("@/lib/editor/draft-write").writeDraft;
  const owners: TestOwner[] = [];
  const blocked: string[] = [];

  const site = async (id: string) =>
    (await admin.from("pages").select("draft").eq("id", id).single()).data!.draft as any;
  const entry = async (id: string) => {
    const { data, error } = await admin
      .from("content_entries")
      .select("id, rev, draft")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return { ...(data as any), rev: Number((data as any).rev) };
  };
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
  async function subPage(o: TestOwner, path = "about") {
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
          title: "About",
          description: "",
          blocks: [{ id: "hdr-sub-0001", type: "header", visible: true, text: "Hello" }],
        } as never,
      })
      .select("id")
      .single();
    if (made.error) throw new Error(made.error.message);
    return made.data.id as string;
  }
  const who = (o: TestOwner) => ({ userId: o.userId });

  beforeAll(async () => {
    admin = adminForTests();
    rt = await makeRuntime(admin);
    ({ writeDraft } = await import("@/lib/editor/draft-write"));
  });
  afterAll(async () => {
    if (blocked.length > 0) await admin.from("blocked_domains").delete().in("domain", blocked);
    await removeOwners(admin, owners);
  });

  describe("Home's blocks", () => {
    it("add_block lands in the '/' entry; the frozen blocks and the design rev stay", async () => {
      const o = await movedOwner("e19-add");
      const frozen = (await site(o.pageId)).blocks;
      const designBefore = await site(o.pageId);
      const before = await entry(o.homeId);
      const out = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "header", fields: { text: "On the entry" } },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const after = await entry(o.homeId);
      expect(after.rev).toBe(before.rev + 1);
      expect(after.draft.blocks).toHaveLength(before.draft.blocks.length + 1);
      expect(JSON.stringify(after.draft.blocks)).toContain("On the entry");
      // Home keeps its path, title and description.
      expect(after.draft).toMatchObject({ path: "/", title: "", description: "" });
      // The site row is exactly as it was.
      expect(await site(o.pageId)).toEqual(designBefore);
      expect((await site(o.pageId)).blocks).toEqual(frozen);
      // The tool reports the entry's rev.
      expect(out.json!.rev).toBe(after.rev);
    });

    it("update_block, move_block and remove_block write the entry too", async () => {
      const o = await movedOwner("e19-ops");
      const designBefore = await site(o.pageId);
      const first = await entry(o.homeId);
      const a = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { label: "Visit the shop" } },
        who(o),
      );
      expect(a.isError, JSON.stringify(a.error)).toBe(false);
      const b = await rt.call(
        "move_block",
        { pageId: o.pageId, blockId: "map-id-00001", position: "first" },
        who(o),
      );
      expect(b.isError, JSON.stringify(b.error)).toBe(false);
      const c = await rt.call(
        "remove_block",
        { pageId: o.pageId, blockId: "card-id-0001" },
        who(o),
      );
      expect(c.isError, JSON.stringify(c.error)).toBe(false);
      const last = await entry(o.homeId);
      expect(last.rev).toBe(first.rev + 3);
      expect(last.draft.blocks[0].id).toBe("map-id-00001");
      expect(JSON.stringify(last.draft.blocks)).toContain("Visit the shop");
      expect(last.draft.blocks.some((x: any) => x.id === "card-id-0001")).toBe(false);
      expect(await site(o.pageId)).toEqual(designBefore);
    });

    it("a stale ifRev is a conflict that writes nothing; the entry's rev goes through", async () => {
      const o = await movedOwner("e19-ifrev");
      const before = await entry(o.homeId);
      const bad = await rt.call(
        "add_block",
        { pageId: o.pageId, ifRev: before.rev + 1, type: "header", fields: { text: "x" } },
        who(o),
      );
      expect(bad.error).toMatchObject({ code: "conflict" });
      expect(await entry(o.homeId)).toEqual(before);
      const good = await rt.call(
        "add_block",
        { pageId: o.pageId, ifRev: before.rev, type: "header", fields: { text: "x" } },
        who(o),
      );
      expect(good.isError, JSON.stringify(good.error)).toBe(false);
      expect((await entry(o.homeId)).rev).toBe(before.rev + 1);
    });

    it("an editor save in between is a conflict (the entry rev is the guard)", async () => {
      const o = await movedOwner("e19-race");
      const before = await entry(o.homeId);
      let moved = false;
      const out = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        scope: "blocks",
        change: async (doc) => {
          if (!moved) {
            moved = true;
            await admin
              .from("content_entries")
              .update({ rev: before.rev + 1 })
              .eq("id", o.homeId);
          }
          return { kind: "write", doc: { ...doc, blocks: [] }, value: null };
        },
      }).catch((error) => error);
      expect(out).toMatchObject({ code: "conflict" });
      expect((await entry(o.homeId)).draft).toEqual(before.draft);
    });

    it("a link to a blocked host is blocked_link and the entry stays as it was", async () => {
      const o = await movedOwner("e19-blocked");
      const domain = `blocked-${Math.random().toString(36).slice(2, 8)}.example`;
      const ins = await admin.from("blocked_domains").insert({ domain, reason: "test" });
      expect(ins.error).toBeNull();
      blocked.push(domain);
      const before = await entry(o.homeId);
      const add = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "link", fields: { label: "Bad", url: `https://${domain}/x` } },
        who(o),
      );
      expect(add.error).toMatchObject({ code: "blocked_link" });
      expect(add.error!.details).toMatchObject({ hosts: [domain] });
      expect(await entry(o.homeId)).toEqual(before);
    });

    it("a suspended owner writes nothing", async () => {
      const o = await movedOwner("e19-susp");
      await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", o.userId);
      const before = await entry(o.homeId);
      const out = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        scope: "blocks",
        change: (doc) => ({ kind: "write", doc: { ...doc, blocks: [] }, value: null }),
      }).catch((error) => error);
      expect(out).toMatchObject({ code: "account_suspended" });
      expect(await entry(o.homeId)).toEqual(before);
    });
  });

  describe("the design", () => {
    it("set_theme lands in pages.draft with the frozen blocks unchanged; the entry stays", async () => {
      const o = await movedOwner("e19-theme");
      const siteBefore = await site(o.pageId);
      const entryBefore = await entry(o.homeId);
      const out = await rt.call(
        "set_theme",
        { pageId: o.pageId, overrides: { bg: "#FAFAFA" } },
        who(o),
      );
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const siteAfter = await site(o.pageId);
      expect(siteAfter.rev).toBe(siteBefore.rev + 1);
      expect(siteAfter.blocks).toEqual(siteBefore.blocks);
      expect(siteAfter.theme.overrides.bg).toBe("#FAFAFA");
      expect(await entry(o.homeId)).toEqual(entryBefore);
      expect(draftDocSchema.safeParse(siteAfter).success).toBe(true);
      // The tool's rev is the design's.
      expect(out.json!.rev).toBe(siteAfter.rev);
    });

    it("update_profile checks ifRev against the design rev, and a stale one writes nothing", async () => {
      const o = await movedOwner("e19-prof");
      const siteBefore = await site(o.pageId);
      const bad = await rt.call(
        "update_profile",
        { pageId: o.pageId, ifRev: siteBefore.rev + 5, name: "Nope" },
        who(o),
      );
      expect(bad.error).toMatchObject({ code: "conflict" });
      expect(await site(o.pageId)).toEqual(siteBefore);
      const ok = await rt.call(
        "update_profile",
        { pageId: o.pageId, ifRev: siteBefore.rev, name: "Mara O." },
        who(o),
      );
      expect(ok.isError, JSON.stringify(ok.error)).toBe(false);
      expect((await site(o.pageId)).profile.name).toBe("Mara O.");
    });

    it("a change that touches the other half is refused and nothing is written", async () => {
      const o = await movedOwner("e19-half");
      const siteBefore = await site(o.pageId);
      const entryBefore = await entry(o.homeId);
      const design = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        scope: "design",
        change: (doc) => ({ kind: "write", doc: { ...doc, blocks: [] }, value: null }),
      }).catch((error) => error);
      expect(design).toMatchObject({ code: "server_error" });
      const blocks = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        scope: "blocks",
        change: (doc) => ({
          kind: "write",
          doc: { ...doc, profile: { ...doc.profile, name: "X" } },
          value: null,
        }),
      }).catch((error) => error);
      expect(blocks).toMatchObject({ code: "server_error" });
      expect(await site(o.pageId)).toEqual(siteBefore);
      expect(await entry(o.homeId)).toEqual(entryBefore);
    });
  });

  describe("a sub-page", () => {
    it("blocks are written to the page's entry under its rev; Home and the design stay", async () => {
      const o = await movedOwner("e19-sub");
      const subId = await subPage(o);
      const siteBefore = await site(o.pageId);
      const homeBefore = await entry(o.homeId);
      const before = await entry(subId);
      const out = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        subPageId: subId,
        scope: "blocks",
        ifRev: before.rev,
        change: (doc) => ({
          kind: "write",
          doc: {
            ...doc,
            title: "About us",
            blocks: [
              ...doc.blocks,
              { id: "hdr-sub-0002", type: "header", visible: true, text: "More" },
            ],
          } as never,
          value: null,
        }),
      });
      expect(out.unchanged).toBe(false);
      const after = await entry(subId);
      expect(out.rev).toBe(after.rev);
      expect(after.rev).toBe(before.rev + 1);
      expect(after.draft.title).toBe("About us");
      expect(after.draft.blocks).toHaveLength(2);
      expect(await site(o.pageId)).toEqual(siteBefore);
      expect(await entry(o.homeId)).toEqual(homeBefore);
    });

    it("a stale ifRev is a conflict; the same change twice is unchanged and keeps the rev", async () => {
      const o = await movedOwner("e19-sub2");
      const subId = await subPage(o);
      const before = await entry(subId);
      const stale = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        subPageId: subId,
        scope: "blocks",
        ifRev: before.rev + 1,
        change: (doc) => ({ kind: "write", doc: { ...doc, title: "Z" } as never, value: null }),
      }).catch((error) => error);
      expect(stale).toMatchObject({ code: "conflict" });
      const same = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        subPageId: subId,
        scope: "blocks",
        change: (doc) => ({ kind: "write", doc: { ...doc } as never, value: null }),
      });
      expect(same.unchanged).toBe(true);
      expect((await entry(subId)).rev).toBe(before.rev);
    });

    it("another owner's page, a page of another site and Home's id are not_found", async () => {
      const a = await movedOwner("e19-xa");
      const b = await movedOwner("e19-xb");
      const subB = await subPage(b);
      const change = () => ({ kind: "unchanged" as const, value: null });
      const cross = await writeDraft({
        admin: admin as never,
        userId: a.userId,
        pageId: a.pageId,
        subPageId: subB,
        scope: "blocks",
        change,
      }).catch((error) => error);
      expect(cross).toMatchObject({ code: "not_found" });
      const foreignSite = await writeDraft({
        admin: admin as never,
        userId: a.userId,
        pageId: b.pageId,
        subPageId: subB,
        scope: "blocks",
        change,
      }).catch((error) => error);
      expect(foreignSite).toMatchObject({ code: "not_found" });
      const home = await writeDraft({
        admin: admin as never,
        userId: a.userId,
        pageId: a.pageId,
        subPageId: a.homeId,
        scope: "blocks",
        change,
      }).catch((error) => error);
      expect(home).toMatchObject({ code: "not_found" });
    });

    it("a path another page already holds is refused as invalid_input", async () => {
      const o = await movedOwner("e19-path");
      const one = await subPage(o, "about");
      const two = await subPage(o, "press");
      const out = await writeDraft({
        admin: admin as never,
        userId: o.userId,
        pageId: o.pageId,
        subPageId: two,
        scope: "blocks",
        change: (doc) => ({ kind: "write", doc: { ...doc, path: "about" } as never, value: null }),
      }).catch((error) => error);
      expect(out).toMatchObject({ code: "invalid_input" });
      expect(one).not.toBe(two);
      expect((await entry(two)).draft.path).toBe("press");
    });
  });
});
