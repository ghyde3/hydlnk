/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftDocSchema, type DraftDoc } from "@/lib/document";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { adminForTests, makeRuntime } from "./support/mcp-db";
import { richDraft } from "./support/mcp-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidateTag: () => undefined, updateTag: () => undefined }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * M10-23 against the local database: the one draft writer the tools share. The revision guard, the
 * database walls under the secret key, untouched means untouched, and the owner filter. Skipped when
 * the local Supabase stack is not up (REQUIRE_SUPABASE=1 makes that a failure).
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("the shared draft writer (local Supabase)", () => {
  let admin: SupabaseClient;
  let rt: Awaited<ReturnType<typeof makeRuntime>>;
  let writeDraft: typeof import("@/lib/editor/draft-write").writeDraft;
  const owners: TestOwner[] = [];
  const blocked: string[] = [];

  const stored = async (pageId: string) => {
    const { data, error } = await admin.from("pages").select("*").eq("id", pageId).single();
    if (error) throw new Error(error.message);
    return data as Record<string, any>;
  };
  async function owner(
    label: string,
    draft?: (handle: string, id: string) => unknown,
    plan: "free" | "pro" = "pro",
  ) {
    // The draft needs the owner's id for image paths, which exists only after the user does.
    const made = draft
      ? await makeOwner(admin, label, (handle) => ({ __pending: handle }), plan)
      : await makeOwner(admin, label, undefined, plan);
    if (draft) {
      const { error } = await admin
        .from("pages")
        .update({ draft: draft(made.handle, made.userId) as never })
        .eq("id", made.pageId);
      if (error) throw new Error(error.message);
    }
    owners.push(made);
    return made;
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

  it("the fixture is a valid draft", () => {
    expect(
      draftDocSchema.safeParse(richDraft("h", "11111111-1111-4111-8111-111111111111")).success,
    ).toBe(true);
  });

  describe("what a write changes and what it does not", () => {
    it("sets the draft and nothing else: published, published_at, handle, name and owner stay", async () => {
      const o = await owner("dw-cols", (h, id) => richDraft(h, id));
      await admin
        .from("pages")
        .update({ published: { version: 1 }, published_at: "2026-10-01T00:00:00Z" })
        .eq("id", o.pageId);
      const before = await stored(o.pageId);
      const out = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "header", fields: { text: "Hi" } },
        who(o),
      );
      expect(out.isError).toBe(false);
      const after = await stored(o.pageId);
      for (const column of [
        "published",
        "published_at",
        "handle",
        "name",
        "owner_id",
        "created_at",
        "id",
      ]) {
        expect(after[column], column).toEqual(before[column]);
      }
      expect(after.draft).not.toEqual(before.draft);
    });

    it.each([
      [
        "add_block",
        (o: TestOwner) => ({ pageId: o.pageId, type: "header", fields: { text: "A new heading" } }),
      ],
      [
        "update_block",
        (o: TestOwner) => ({
          pageId: o.pageId,
          blockId: "card-id-0001",
          fields: { caption: "Back in stock" },
        }),
      ],
      [
        "move_block",
        (o: TestOwner) => ({ pageId: o.pageId, blockId: "map-id-00001", position: "first" }),
      ],
      ["remove_block", (o: TestOwner) => ({ pageId: o.pageId, blockId: "map-id-00001" })],
      ["update_profile", (o: TestOwner) => ({ pageId: o.pageId, name: "Mara O." })],
      ["set_theme", (o: TestOwner) => ({ pageId: o.pageId, overrides: { bg: "#FAFAFA" } })],
    ])(
      "%s keeps every key it did not name deep-equal, version at 1 and rev at old plus one",
      async (tool, input) => {
        const o = await owner(`dw-${tool.replace(/_/g, "-").slice(0, 6)}`, (h, id) =>
          richDraft(h, id, 7),
        );
        const before = (await stored(o.pageId)).draft as DraftDoc;
        const out = await rt.call(tool, input(o), who(o));
        expect(out.isError, JSON.stringify(out.error)).toBe(false);
        const after = (await stored(o.pageId)).draft as DraftDoc;
        expect(after.version).toBe(1);
        expect(after.rev).toBe(before.rev + 1);
        // Everything outside the one thing the tool named.
        const keep = (draft: DraftDoc, skip: string[]) => {
          const copy = JSON.parse(JSON.stringify(draft)) as Record<string, any>;
          delete copy.rev;
          for (const key of skip) delete copy[key];
          return copy;
        };
        const touched: Record<string, string[]> = {
          add_block: ["blocks"],
          update_block: ["blocks"],
          move_block: ["blocks"],
          remove_block: ["blocks"],
          update_profile: ["profile"],
          set_theme: ["theme"],
        };
        expect(keep(after, touched[tool]!)).toEqual(keep(before, touched[tool]!));
        if (!["update_profile"].includes(tool)) expect(after.profile).toEqual(before.profile);
        // The blocks the tool did not name are untouched, with their lock, UTM, marks and style.
        const keptBlocks = (draft: DraftDoc) =>
          draft.blocks.filter(
            (block) =>
              !["card-id-0001", "map-id-00001"].includes(block.id) && block.type !== "header",
          );
        expect(keptBlocks(after)).toEqual(keptBlocks(before));
        expect(draftDocSchema.safeParse(after).success).toBe(true);
      },
    );

    it("a block's own style, lock, UTM tags and text formatting survive a change to another field of another block", async () => {
      const o = await owner("dw-keys", (h, id) => richDraft(h, id));
      const before = (await stored(o.pageId)).draft as DraftDoc;
      await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { label: "Visit the shop" } },
        who(o),
      );
      const after = (await stored(o.pageId)).draft as DraftDoc;
      const link = after.blocks[0] as any;
      expect(link.label).toBe("Visit the shop");
      expect(link).toMatchObject({
        lock: { kind: "age" },
        utm: { source: "shop", off: false },
        overrides: { radius: 4, accent: "#445566" },
        featured: "bold",
      });
      expect(after.blocks[1]).toEqual(before.blocks[1]);
      expect(after.banner).toEqual(before.banner);
      expect(after.share).toEqual(before.share);
      expect(after.utm).toEqual(before.utm);
      expect(after.redirect).toEqual(before.redirect);
    });
  });

  describe("the revision guard", () => {
    it("ifRev that matches writes, and one that does not is a conflict that writes nothing", async () => {
      const o = await owner("dw-ifrev", (h, id) => richDraft(h, id, 5));
      const bad = await rt.call(
        "add_block",
        { pageId: o.pageId, ifRev: 4, type: "header", fields: { text: "x" } },
        who(o),
      );
      expect(bad.error).toMatchObject({
        code: "conflict",
        message:
          "This page changed while I was working on it. Call get_page again and redo the change.",
      });
      expect(((await stored(o.pageId)).draft as DraftDoc).rev).toBe(5);
      const good = await rt.call(
        "add_block",
        { pageId: o.pageId, ifRev: 5, type: "header", fields: { text: "x" } },
        who(o),
      );
      expect(good.isError).toBe(false);
      expect(good.json!.rev).toBe(6);
    });

    it("a save made in the editor while a tool works is a conflict, never merged and never retried", async () => {
      const o = await owner("dw-stale", (h, id) => richDraft(h, id, 2));
      const editorsDraft = {
        ...richDraft(o.handle, o.userId, 3),
        profile: { ...richDraft(o.handle, o.userId).profile, name: "Typed in the editor" },
      };
      let changeCalls = 0;
      await expect(
        writeDraft({
          admin: admin as never,
          userId: o.userId,
          pageId: o.pageId,
          change: async (doc) => {
            changeCalls += 1;
            // The editor's autosave lands between the read and the write.
            await admin
              .from("pages")
              .update({ draft: editorsDraft as never })
              .eq("id", o.pageId);
            return { kind: "write", doc: { ...doc, blocks: [] }, value: null };
          },
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(changeCalls).toBe(1);
      const now = (await stored(o.pageId)).draft as DraftDoc;
      expect(now.profile.name).toBe("Typed in the editor");
      expect(now.blocks.length).toBeGreaterThan(0);
    });

    it("two add_block calls started together never both write from the same rev (repeated 20 times)", async () => {
      const o = await owner("dw-race", (h, id) => ({ ...richDraft(h, id, 0), blocks: [] }));
      for (let round = 0; round < 20; round++) {
        const before = (await stored(o.pageId)).draft as DraftDoc;
        const calls = await Promise.all(
          [0, 1].map((n) =>
            rt.call(
              "add_block",
              { pageId: o.pageId, type: "header", fields: { text: `Round ${round} call ${n}` } },
              who(o),
            ),
          ),
        );
        const wins = calls.filter((call) => !call.isError).length;
        expect(wins, `round ${round}`).toBeGreaterThanOrEqual(1);
        for (const loser of calls.filter((call) => call.isError))
          expect(loser.error!.code).toBe("conflict");
        const after = (await stored(o.pageId)).draft as DraftDoc;
        expect(after.blocks.length - before.blocks.length).toBe(wins);
        expect(after.rev - before.rev).toBe(wins);
      }
    });
  });

  describe("the database walls under the secret key", () => {
    it("a link to a blocked host is blocked_link, and the stored draft stays as it was", async () => {
      const o = await owner("dw-blocked", (h, id) => richDraft(h, id));
      const domain = `blocked-${Math.random().toString(36).slice(2, 8)}.example`;
      const { error } = await admin.from("blocked_domains").insert({ domain, reason: "test" });
      expect(error).toBeNull();
      blocked.push(domain);
      const before = await stored(o.pageId);
      const add = await rt.call(
        "add_block",
        { pageId: o.pageId, type: "link", fields: { label: "Bad", url: `https://${domain}/x` } },
        who(o),
      );
      expect(add.error).toMatchObject({
        code: "blocked_link",
        message: "That site is blocked. Use a different link.",
      });
      expect(add.error!.issues?.length).toBeGreaterThan(0);
      expect(add.error!.details).toMatchObject({ hosts: [domain] });
      const update = await rt.call(
        "update_block",
        { pageId: o.pageId, blockId: "link-id-001", fields: { url: `https://${domain}/y` } },
        who(o),
      );
      expect(update.error!.code).toBe("blocked_link");
      expect((await stored(o.pageId)).draft).toEqual(before.draft);
      // No database code or word ever reaches the message.
      expect(JSON.stringify([add.raw, update.raw])).not.toMatch(
        /HL005|23514|violates|trigger|postgres/i,
      );
    });

    it("a draft past the size limit is too_large, and a page of 50 blocks takes no 51st", async () => {
      const o = await owner("dw-big", (h, id) => richDraft(h, id));
      const before = await stored(o.pageId);
      await expect(
        writeDraft({
          admin: admin as never,
          userId: o.userId,
          pageId: o.pageId,
          change: (doc) => {
            const blocks = Array.from({ length: 50 }, (_, index) => ({
              id: `big-block-${String(index).padStart(3, "0")}`,
              type: "faq" as const,
              visible: true,
              items: Array.from({ length: 10 }, (__, item) => ({
                id: `big-item-${String(index).padStart(3, "0")}-${item}`,
                question: "q".repeat(120),
                answer: "a".repeat(600),
              })),
            }));
            return { kind: "write", doc: { ...doc, blocks: blocks as never }, value: null };
          },
        }),
      ).rejects.toMatchObject({ code: "too_large" });
      expect((await stored(o.pageId)).draft).toEqual(before.draft);

      const full = await owner("dw-full", (h, id) => ({
        ...richDraft(h, id),
        blocks: Array.from({ length: 50 }, (_, index) => ({
          id: `full-block-${String(index).padStart(3, "0")}`,
          type: "divider",
          visible: true,
        })),
      }));
      const out = await rt.call("add_block", { pageId: full.pageId, type: "divider" }, who(full));
      expect(out.error).toMatchObject({
        code: "block_limit",
        message: "Pages can have 50 blocks. Remove one first.",
      });
    });

    it("a draft that cannot be read is server_error and is never overwritten", async () => {
      const o = await owner("dw-junk");
      await admin
        .from("pages")
        .update({ draft: { blocks: 5 } as never })
        .eq("id", o.pageId);
      const out = await rt.call("add_block", { pageId: o.pageId, type: "header" }, who(o));
      expect(out.error).toMatchObject({
        code: "server_error",
        message: "This page’s draft can’t be read. Open it in the editor.",
      });
      expect((await stored(o.pageId)).draft).toEqual({ blocks: 5 });
    });
  });

  describe("ownership and suspension", () => {
    it("another account's page, a random uuid, a malformed id and a deleted page are one answer, byte for byte", async () => {
      const mine = await owner("dw-own-a");
      const theirs = await owner("dw-own-b", (h, id) => richDraft(h, id));
      const gone = await owner("dw-own-c");
      await admin.from("pages").delete().eq("id", gone.pageId);
      const before = await stored(theirs.pageId);
      const bodies = new Set<string>();
      for (const pageId of [
        theirs.pageId,
        "00000000-0000-4000-8000-0000000000ff",
        "not-a-uuid",
        "../x",
        gone.pageId,
      ]) {
        for (const [tool, input] of [
          ["add_block", { type: "header" }],
          ["update_profile", { name: "Hijack" }],
          ["get_page", {}],
          ["publish_page", {}],
        ] as const) {
          const out = await rt.call(tool, { pageId, ...input }, who(mine));
          expect(out.error!.code, `${tool} ${pageId}`).toBe("not_found");
          bodies.add(JSON.stringify(out.raw));
          expect(JSON.stringify(out.raw)).not.toMatch(/forbidden/i);
        }
      }
      expect(bodies.size).toBe(1);
      expect((await stored(theirs.pageId)).draft).toEqual(before.draft);
    });

    it("a suspended account's write is refused by the tool wrapper and by the writer itself", async () => {
      const o = await owner("dw-susp");
      expect(
        (await rt.call("add_block", { pageId: o.pageId, type: "header" }, who(o))).isError,
      ).toBe(false);
      await admin
        .from("accounts")
        .update({ suspended_at: new Date().toISOString() })
        .eq("id", o.userId);
      const refused = await rt.call("add_block", { pageId: o.pageId, type: "header" }, who(o));
      expect(refused.error).toMatchObject({
        code: "account_suspended",
        message: "Your account is suspended. Contact support to appeal.",
      });
      // The writer reads the account on its own: a caller that skipped the wrapper's check is refused too.
      await expect(
        writeDraft({
          admin: admin as never,
          userId: o.userId,
          pageId: o.pageId,
          change: (doc) => ({ kind: "write", doc, value: null }),
        }),
      ).rejects.toMatchObject({ code: "account_suspended" });
      // Reads are refused too (M10-22): every tool answers account_suspended.
      expect((await rt.call("get_page", { pageId: o.pageId }, who(o))).error!.code).toBe(
        "account_suspended",
      );
    });
  });

  describe("media", () => {
    it("a write that drops an image schedules the media cleanup, and the dropped path is in the queue", async () => {
      const o = await owner("dw-media", (h, id) => richDraft(h, id));
      const dropped = `${o.userId}/glaze000001.webp`;
      const out = await rt.call(
        "remove_block",
        { pageId: o.pageId, blockId: "card-id-0001" },
        who(o),
      );
      expect(out.isError).toBe(false);
      expect(rt.deferred.length).toBeGreaterThan(0);
      const queue = await admin.from("image_cleanup_queue").select("path").eq("owner_id", o.userId);
      expect(queue.data?.map((row: { path: string }) => row.path)).toContain(dropped);
    });
  });
});
