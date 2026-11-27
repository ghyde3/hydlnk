/* eslint-disable @typescript-eslint/no-explicit-any -- a tool result is JSON whose shape each test checks */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stackIsUp } from "./publish-support";
import {
  READ,
  READ_WRITE,
  contentHarness,
  type BlogOwner,
  type ContentHarness,
} from "./support/mcp-content-db";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown, tags: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => mocks.admin }));
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, options: { expire?: number }) => {
    if (options?.expire !== 0) throw new Error("a tool must expire at once");
    mocks.tags.push(tag);
  },
  updateTag: () => {
    throw new Error("updateTag works in Server Actions only");
  },
}));
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const { run } = await stackIsUp();

/**
 * M18-09 against the local database: `publish_design` makes theme, menu and profile live and no
 * page or post; `publish_page` called exactly as before still publishes the design and every
 * changed page, and no post. Each publish tool expires exactly its tags.
 */
describe.skipIf(!run)("publish_design, and publish_page keeps its meaning (local Supabase)", () => {
  let h: ContentHarness;

  async function liveSite(label: string) {
    const o = await h.owner(label, { plan: "pro", publishable: true });
    const about = await h.subPage(o, "about", "About");
    const all = await h.call("publish_page", { pageId: o.pageId }, o);
    if (all.isError) throw new Error(`publish_page: ${JSON.stringify(all.error)}`);
    return { o, about };
  }
  const designRevOf = async (o: BlogOwner) =>
    (await h.call("get_page", { pageId: o.pageId }, o, READ)).json!.page.designRev;

  beforeAll(async () => {
    h = await contentHarness();
    mocks.admin = h.admin;
  });
  afterAll(async () => h?.cleanup());
  beforeEach(() => {
    mocks.tags.length = 0;
  });

  describe("publish_design", () => {
    it("makes the profile live and no page or post: every entry keeps its live copy and rev", async () => {
      const { o, about } = await liveSite("pd-ok");
      const post = await h.post(o, { title: "A draft post" });
      const livePost = await h.post(o, { title: "A live post" });
      await h.call("publish_entry", { entryId: livePost.id, ifRev: 1 }, o);
      // The design changes, Home's blocks change, a sub-page changes: only the design may go live.
      await h.call("update_profile", { pageId: o.pageId, bio: "The new live bio" }, o);
      await h.call(
        "add_block",
        { pageId: o.pageId, type: "header", fields: { text: "Draft-only header" } },
        o,
      );
      await h.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: about, title: "Draft-only title" },
        o,
      );
      const before = await h.siteSnapshot(o.pageId);
      const designRev = await designRevOf(o);
      mocks.tags.length = 0;

      const out = await h.call("publish_design", { pageId: o.pageId, ifDesignRev: designRev }, o);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      expect(out.json).toMatchObject({
        published: true,
        pageId: o.pageId,
        url: `http://${o.handle}.localhost:3000`,
      });
      const after = await h.siteSnapshot(o.pageId);
      expect(JSON.stringify(after.design.published)).toContain("The new live bio");
      expect(JSON.stringify(before.design.published)).not.toContain("The new live bio");
      // Every entry, Home's included: live copy, dates, address and rev are what they were.
      expect(after.entries).toEqual(before.entries);
      expect(after.types).toEqual(before.types);
      expect(JSON.stringify(after.entries)).not.toContain("Draft-only header");
      expect(JSON.stringify(after.entries)).not.toContain("Draft-only title");
      // Exactly the site's tag.
      expect(mocks.tags).toEqual([`page:${o.pageId}`]);
      // The answer's designRev is the one get_page shows now.
      expect(out.json!.designRev).toBe(await designRevOf(o));
      void post;
    });

    it("takes designRev as get_page prints it (a number) and as text", async () => {
      const { o } = await liveSite("pd-form");
      const designRev = await designRevOf(o);
      expect(typeof designRev).toBe("number");
      const asNumber = await h.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: designRev },
        o,
      );
      expect(asNumber.isError, JSON.stringify(asNumber.error)).toBe(false);
      const asText = await h.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: String(await designRevOf(o)) },
        o,
      );
      expect(asText.isError, JSON.stringify(asText.error)).toBe(false);
    });

    it("designRev 0 is real: a live design at rev 0 publishes with the 0 get_page prints", async () => {
      const { o } = await liveSite("pd-zero");
      // A design no one has edited since the site was made is at rev 0 (the document default).
      const page = await h.admin.from("pages").select("draft").eq("id", o.pageId).single();
      expect(page.error).toBeNull();
      const zeroed = await h.admin
        .from("pages")
        .update({ draft: { ...(page.data!.draft as Record<string, unknown>), rev: 0 } })
        .eq("id", o.pageId);
      expect(zeroed.error).toBeNull();
      expect(await designRevOf(o)).toBe(0);
      const out = await h.call("publish_design", { pageId: o.pageId, ifDesignRev: 0 }, o);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
    });

    it("a stale rev is conflict, a missing one invalid_input: nothing is published and no tag is expired", async () => {
      const { o } = await liveSite("pd-stale");
      const stale = await designRevOf(o);
      await h.call("update_profile", { pageId: o.pageId, bio: "Edited after the read" }, o);
      const before = await h.siteSnapshot(o.pageId);
      mocks.tags.length = 0;
      for (const ifDesignRev of [stale, "0", 0, "nonsense", 999_999]) {
        const out = await h.call("publish_design", { pageId: o.pageId, ifDesignRev }, o);
        expect(out.error, String(ifDesignRev)).toEqual({
          code: "conflict",
          message:
            "This page changed while I was working on it. Call get_page again and redo the change.",
        });
        expect(JSON.stringify(out.raw)).not.toMatch(/currentRev|designRev/);
      }
      const missing = await h.call("publish_design", { pageId: o.pageId }, o);
      expect(missing.error?.code).toBe("invalid_input");
      expect(missing.error!.issues![0]!.path).toBe("ifDesignRev");
      // null is never a designRev get_page prints: it is refused before the gate.
      for (const bad of [null, 1.5, -1, true, { rev: 1 }, "x".repeat(41)]) {
        const out = await h.call("publish_design", { pageId: o.pageId, ifDesignRev: bad }, o);
        expect(out.error?.code, JSON.stringify(bad)).toBe("invalid_input");
      }
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
      expect(mocks.tags).toEqual([]);
    });

    it("a site never published answers publish_refused naming publish_page", async () => {
      const o = await h.owner("pd-never", { publishable: true });
      const before = await h.siteSnapshot(o.pageId);
      const out = await h.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: await designRevOf(o) },
        o,
      );
      expect(out.error).toMatchObject({ code: "publish_refused" });
      expect(out.error!.message).toContain("publish_page");
      expect(out.error!.message).toContain("This site isn’t live yet.");
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
      expect(mocks.tags).toEqual([]);
    });

    it("needs the publish scope and the caller's own site; a suspended account publishes nothing", async () => {
      const { o } = await liveSite("pd-who");
      const designRev = await designRevOf(o);
      const before = await h.siteSnapshot(o.pageId);
      mocks.tags.length = 0;
      const write = await h.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: designRev },
        o,
        READ_WRITE,
      );
      expect(write.error).toMatchObject({
        code: "insufficient_scope",
        requiredScope: "hydlnk.publish",
      });
      const stranger = await h.owner("pd-str");
      const foreign = await h.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: designRev },
        stranger,
      );
      expect(foreign.error?.code).toBe("not_found");
      await h.suspend(o, true);
      const suspended = await h.call(
        "publish_design",
        { pageId: o.pageId, ifDesignRev: designRev },
        o,
      );
      expect(suspended.error?.code).toBe("account_suspended");
      await h.suspend(o, false);
      expect(await h.siteSnapshot(o.pageId)).toEqual(before);
      expect(mocks.tags).toEqual([]);
    });
  });

  describe("publish_page keeps its meaning", () => {
    it("called exactly as before (only pageId) it publishes the design and every changed page, and no post", async () => {
      const { o, about } = await liveSite("pd-all");
      const draftPost = await h.post(o, { title: "Stays a draft", body: "Not live" });
      const livePost = await h.post(o, { title: "Live before", body: "Old live body" });
      const published = await h.call("publish_entry", { entryId: livePost.id, ifRev: 1 }, o);
      await h.call(
        "update_entry",
        { entryId: livePost.id, ifRev: published.json!.rev, body: "New draft body" },
        o,
      );
      await h.call("update_profile", { pageId: o.pageId, bio: "Bio for everyone" }, o);
      await h.call(
        "add_block",
        { pageId: o.pageId, type: "header", fields: { text: "Header for everyone" } },
        o,
      );
      await h.call(
        "update_page_settings",
        { pageId: o.pageId, subPageId: about, title: "About for everyone" },
        o,
      );
      const postsBefore = [await h.row(draftPost.id), await h.row(livePost.id)];
      mocks.tags.length = 0;

      const out = await h.call("publish_page", { pageId: o.pageId }, o);
      expect(out.isError, JSON.stringify(out.error)).toBe(false);
      const after = await h.siteSnapshot(o.pageId);
      expect(JSON.stringify(after.design.published)).toContain("Bio for everyone");
      expect(JSON.stringify((await h.row(o.homeId)).published)).toContain("Header for everyone");
      expect((await h.row(about)).published.title).toBe("About for everyone");
      // The posts are exactly as they were: the draft is not live, the live one keeps its old copy.
      expect([await h.row(draftPost.id), await h.row(livePost.id)]).toEqual(postsBefore);
      expect(postsBefore[0]!.published).toBeNull();
      expect(postsBefore[1]!.published.body).toBe("Old live body");
      expect(mocks.tags).toEqual([`page:${o.pageId}`]);
    });

    it("says so in its description, and takes nothing but pageId", async () => {
      const { toolByName } = await import("@/lib/mcp/tools");
      const tool = toolByName("publish_page")!;
      expect(tool.description).toContain("Posts are published with publish_entry.");
      expect(tool.description).toContain("It publishes all changes");
      expect(tool.description.length).toBeLessThanOrEqual(800);
      for (const extra of [{ ifRev: 1 }, { ifDesignRev: "1" }, { entryId: "x" }]) {
        expect(tool.input.safeParse({ pageId: "x", ...extra }).success).toBe(false);
      }
      expect(tool.input.safeParse({}).success).toBe(true);
      expect(toolByName("publish_design")!.description).toContain(
        "No page and no post is published",
      );
    });
  });
});
