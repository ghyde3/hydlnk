import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publishedDocSchema, type Block } from "@/lib/document";
import { makePng } from "../e2e/m2/publish-helpers";
import {
  draftOf,
  makeOwner,
  publishedOf,
  rand,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M6-20 and M6-22 at the Publish gate, against the local Supabase with the secret key: the abuse
 * cases are written into `pages.draft` the way a client with the publishable key could write them
 * (the database takes any draft), then Publish is attempted. A refusal names the block and the field
 * and leaves `pages.published` exactly as it was. Also the cleanup rule: a replaced or removed
 * thumbnail changes only the draft, and the M5-14 cleanup keeps an object a draft or the published
 * page still names.
 */
const { run } = await stackIsUp();

const link = (id: string, extra: Record<string, unknown> = {}): Block =>
  ({
    id,
    type: "link",
    visible: true,
    label: "Book",
    url: "https://example.com/book",
    ...extra,
  }) as Block;

describe.skipIf(!run)("M6-20 and M6-22 publish gate (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  let cleanup: typeof import("@/lib/media/cleanup-admin");
  const owners: TestOwner[] = [];
  const objects: string[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
    cleanup = await import("@/lib/media/cleanup-admin");
  });

  afterAll(async () => {
    if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
    await removeOwners(admin, owners);
  });

  const owner = async (label: string, blocks: Block[] = []) => {
    const made = await makeOwner(admin, label, (handle) => draftOf(handle, blocks));
    owners.push(made);
    return made;
  };
  const writeDraft = async (o: TestOwner, blocks: Block[]) => {
    const { error } = await admin
      .from("pages")
      .update({ draft: draftOf(o.handle, blocks) as never })
      .eq("id", o.pageId);
    expect(error).toBeNull();
  };
  const publish = (o: TestOwner) =>
    core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
  /** Stores a real image in the owner's folder, named the way the avatar pipeline names it. */
  const upload = async (o: TestOwner, hash = rand(12).padEnd(12, "a")) => {
    const path = `${o.userId}/avatar-${hash}.webp`;
    const { error } = await admin.storage
      .from("page-media")
      .upload(path, makePng(8, 8), { contentType: "image/webp" });
    expect(error).toBeNull();
    objects.push(path);
    return { path, width: 400, height: 400 };
  };
  const exists = async (path: string) =>
    (await admin.storage.from("page-media").exists(path)).data === true;

  describe("a valid icon publishes", () => {
    it("a built-in name and a thumbnail in the owner's folder reach pages.published, canonical", async () => {
      const o = await owner("lp1");
      const thumb = await upload(o);
      await writeDraft(o, [
        link("lnk-icon-0001", { icon: { type: "builtin", name: "star" } }),
        link("lnk-thumb-001", {
          icon: { type: "image", image: { ...thumb, url: "https://evil.example/x", extra: 1 } },
        }),
        link("lnk-plain-001"),
      ]);
      expect((await publish(o)).ok).toBe(true);
      const { published } = await publishedOf(admin, o.pageId);
      const doc = publishedDocSchema.parse(published);
      expect(doc.blocks[0]).toMatchObject({ icon: { type: "builtin", name: "star" } });
      expect((doc.blocks[1] as { icon: unknown }).icon).toEqual({ type: "image", image: thumb });
      expect("icon" in doc.blocks[2]!).toBe(false);
      expect(JSON.stringify(published)).not.toContain("evil.example");
    });

    it("three featured links publish with their values", async () => {
      const o = await owner("lp2");
      await writeDraft(o, [
        link("lnk-feat-0001", { featured: "bold" }),
        link("lnk-feat-0002", { featured: "pulse" }),
        link("lnk-feat-0003", { featured: "shine" }),
        link("lnk-feat-0004"),
      ]);
      expect((await publish(o)).ok).toBe(true);
      const doc = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
      expect(doc.blocks.map((b) => (b as { featured?: string }).featured)).toEqual([
        "bold",
        "pulse",
        "shine",
        undefined,
      ]);
    });
  });

  describe("direct draft writes the gate must refuse (published stays as it was)", () => {
    it("an icon name that is not on the list: the block and the field are named", async () => {
      const o = await owner("lp3");
      await writeDraft(o, [link("lnk-good-0001")]);
      expect((await publish(o)).ok).toBe(true);
      const before = await publishedOf(admin, o.pageId);

      for (const name of [
        "Instagram",
        "<script>alert(1)</script>",
        'x"onload="alert(1)',
        "__proto__",
      ]) {
        await writeDraft(o, [link("lnk-bad-00001", { icon: { type: "builtin", name } })]);
        const result = await publish(o);
        expect(result).toMatchObject({ ok: false, reason: "invalid" });
        if (result.ok) throw new Error("unreachable");
        expect(result.errors).toEqual([
          { blockId: "lnk-bad-00001", field: "icon.name", message: "Pick an icon from the list." },
        ]);
        expect(await publishedOf(admin, o.pageId)).toEqual(before);
      }
    });

    it("a thumbnail in another account's folder is refused: that image isn't yours", async () => {
      const o = await owner("lp4");
      const stranger = await owner("lp5");
      const theirs = await upload(stranger);
      await writeDraft(o, [link("lnk-theirs-001", { icon: { type: "image", image: theirs } })]);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      if (result.ok) throw new Error("unreachable");
      expect(result.errors).toEqual([
        {
          blockId: "lnk-theirs-001",
          field: "icon",
          message: "That image isn’t in your uploads. Upload it again.",
        },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
    });

    it("a thumbnail whose object is gone is refused: no longer available", async () => {
      const o = await owner("lp6");
      const gone = { path: `${o.userId}/avatar-0123456789ab.webp`, width: 400, height: 400 };
      await writeDraft(o, [link("lnk-gone-00001", { icon: { type: "image", image: gone } })]);
      const result = await publish(o);
      if (result.ok) throw new Error("published a missing image");
      expect(result.errors).toEqual([
        {
          blockId: "lnk-gone-00001",
          field: "icon",
          message: "That image is no longer available. Upload it again.",
        },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
    });

    it("an image path that is a URL or climbs out of the folder never gets as far as the media check", async () => {
      const o = await owner("lp7");
      for (const path of [
        "https://evil.example/a.png",
        `${o.userId}/../x/avatar-0123456789ab.webp`,
      ]) {
        await writeDraft(o, [
          link("lnk-path-00001", {
            icon: { type: "image", image: { path, width: 400, height: 400 } },
          }),
        ]);
        const result = await publish(o);
        expect(result).toMatchObject({ ok: false, reason: "invalid" });
        if (result.ok) throw new Error("unreachable");
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ blockId: "lnk-path-00001" });
        expect(result.errors[0]!.field.startsWith("icon")).toBe(true);
        expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
      }
    });

    it("a hidden block is exempt: Publish drops it, bad icon and all", async () => {
      const o = await owner("lp8");
      await writeDraft(o, [
        link("lnk-hide-00001", {
          visible: false,
          icon: { type: "builtin", name: "Instagram" },
          featured: "blink",
        }),
        link("lnk-show-00001"),
      ]);
      expect((await publish(o)).ok).toBe(true);
      const doc = publishedDocSchema.parse((await publishedOf(admin, o.pageId)).published);
      expect(doc.blocks.map((b) => b.id)).toEqual(["lnk-show-00001"]);
    });

    it("five featured links in a draft: the 4th and 5th are named and nothing is published", async () => {
      const o = await owner("lp9");
      const blocks = ["1", "2", "3", "4", "5"].map((n) =>
        link(`lnk-five-000${n}`, { featured: "bold" }),
      );
      await writeDraft(o, blocks);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      if (result.ok) throw new Error("unreachable");
      expect(result.errors).toEqual([
        {
          blockId: "lnk-five-0004",
          field: "featured",
          message: "Feature up to 3 links. Turn one off to feature another.",
        },
        {
          blockId: "lnk-five-0005",
          field: "featured",
          message: "Feature up to 3 links. Turn one off to feature another.",
        },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });

      // Hiding the extras makes it publishable: hidden blocks do not count.
      await writeDraft(
        o,
        blocks.map((b, i) => (i >= 3 ? ({ ...b, visible: false } as Block) : b)),
      );
      expect((await publish(o)).ok).toBe(true);
    });

    it("a featured value that is not one of the three is refused and named", async () => {
      const o = await owner("lp10");
      for (const featured of ["blink", true, 1, 'bold"x']) {
        await writeDraft(o, [link("lnk-feat-bad01", { featured })]);
        const result = await publish(o);
        expect(result).toMatchObject({ ok: false });
        expect(await publishedOf(admin, o.pageId)).toEqual({ published: null, published_at: null });
      }
    });
  });

  describe("replacing or removing a thumbnail changes only the draft", () => {
    it("the published page keeps its object until a Publish drops it; the cleanup keeps what a draft or the published page names", async () => {
      const o = await owner("lp11");
      const first = await upload(o, "111111111111");
      const second = await upload(o, "222222222222");
      await writeDraft(o, [link("lnk-swap-00001", { icon: { type: "image", image: first } })]);
      expect((await publish(o)).ok).toBe(true);
      const published = await publishedOf(admin, o.pageId);

      // The draft moves to the second thumbnail: pages.published is untouched and the first
      // object is still readable (the live page shows it).
      await writeDraft(o, [link("lnk-swap-00001", { icon: { type: "image", image: second } })]);
      expect(await publishedOf(admin, o.pageId)).toEqual(published);
      expect(await exists(first.path)).toBe(true);
      let result = await cleanup.cleanupMediaFor(o.userId, admin);
      expect(result.deleted).not.toContain(first.path);
      expect(await exists(first.path)).toBe(true);
      expect(await exists(second.path)).toBe(true);

      // Removing the icon from the draft: the second one is only in the draft now... and it is
      // dropped, so the cleanup may take it, but the first is still held by the published page.
      await writeDraft(o, [link("lnk-swap-00001")]);
      result = await cleanup.cleanupMediaFor(o.userId, admin);
      expect(result.deleted).not.toContain(first.path);
      expect(await exists(first.path)).toBe(true);

      // The Publish that drops it queues it, and then the cleanup removes it.
      expect((await publish(o)).ok).toBe(true);
      result = await cleanup.cleanupMediaFor(o.userId, admin);
      expect(result.deleted).toContain(first.path);
      expect(await exists(first.path)).toBe(false);
    });
  });
});
