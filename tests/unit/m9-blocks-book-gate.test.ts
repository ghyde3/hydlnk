import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findLinkUrl } from "@/lib/analytics/ingest/target";
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
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn(),
}));

// Database and Storage round trips: a loaded machine can take far longer than 5 seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M9-20, M9-21 and M9-22 through the real Publish gate (`publishPageCore`, local Supabase, the
 * secret key): drafts are written the way a client with the publishable key could write them
 * (straight into `pages.draft`), then Publish is attempted. What it proves that the schema tests
 * cannot: the cover is held to the owner's folder and to Storage under the field `cover`, a hidden
 * block is exempt, a store link to a domain listed after the save stops Publish with the link's own
 * id, and a published document answers `/r` for the ids it holds.
 */
const { run } = await stackIsUp();

const MESSAGE_FOREIGN = "That image isn’t in your uploads. Upload it again.";
const MESSAGE_GONE = "That image is no longer available. Upload it again.";

const link = (id: string, store: string, url = `https://example.com/${store}`) => ({
  id,
  store,
  url,
});
const book = (extra: Record<string, unknown> = {}): Block =>
  ({
    id: "book-gate-0001",
    type: "book",
    visible: true,
    title: "The Night Market",
    author: "Mara",
    cover: null,
    links: [link("book-gate-amzn1", "amazon")],
    ...extra,
  }) as Block;
const apps = (extra: Record<string, unknown> = {}): Block =>
  ({
    id: "apps-gate-0001",
    type: "apps",
    visible: true,
    links: [link("apps-gate-appl1", "appstore"), link("apps-gate-play1", "googleplay")],
    ...extra,
  }) as Block;
const map = (extra: Record<string, unknown> = {}): Block =>
  ({
    id: "map-gate-00001",
    type: "map",
    visible: true,
    name: "Okafor Studio",
    address: "12 Canal Street, Brooklyn, NY",
    googleId: "map-gate-goog1",
    appleId: "map-gate-appl1",
    ...extra,
  }) as Block;

describe.skipIf(!run)(
  "M9-20/21/22 the Publish gate for book, apps and map (local Supabase)",
  () => {
    let admin: SupabaseClient;
    let core: typeof import("@/lib/publish/core");
    const owners: TestOwner[] = [];
    const objects: string[] = [];
    const domains: string[] = [];

    beforeAll(async () => {
      const { createClient } = await import("@supabase/supabase-js");
      admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        {
          auth: { persistSession: false },
        },
      );
      core = await import("@/lib/publish/core");
    });

    afterAll(async () => {
      if (objects.length > 0) await admin.storage.from("page-media").remove(objects);
      if (domains.length > 0) await admin.from("blocked_domains").delete().in("domain", domains);
      await removeOwners(admin, owners);
    });

    const owner = async (label: string, blocks: Block[] = []) => {
      const made = await makeOwner(admin, label, (handle) => draftOf(handle, blocks));
      owners.push(made);
      return made;
    };
    const writeBlocks = async (o: TestOwner, blocks: Block[]) => {
      const { error } = await admin
        .from("pages")
        .update({ draft: draftOf("Alpha", blocks) as never })
        .eq("id", o.pageId);
      expect(error).toBeNull();
    };
    const publish = (o: TestOwner) =>
      core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
    const upload = async (o: TestOwner) => {
      const path = `${o.userId}/img-${rand(12).padEnd(12, "a")}.webp`;
      const { error } = await admin.storage
        .from("page-media")
        .upload(path, new Uint8Array(makePng(8, 8)), { contentType: "image/webp" });
      expect(error).toBeNull();
      objects.push(path);
      return path;
    };

    it("a cover from the owner's own upload publishes, with no focus, and the stored document holds the ids", async () => {
      const o = await owner("bk1");
      const path = await upload(o);
      await writeBlocks(o, [
        book({
          cover: { path, width: 800, height: 1200, focus: { x: 0.1, y: 0.9 } },
          links: [link("book-gate-amzn1", "amazon"), link("book-gate-bksh1", "bookshop")],
        }),
        apps(),
        map(),
      ]);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: true });
      const { published } = await publishedOf(admin, o.pageId);
      const doc = publishedDocSchema.parse(published);
      const stored = doc.blocks[0] as { cover: unknown };
      expect(stored.cover).toEqual({ path, width: 800, height: 1200 });
      expect(JSON.stringify(published)).not.toContain("focus");
      // The click targets come from the stored form, by id.
      expect(findLinkUrl(doc, "book-gate-bksh1")).toBe("https://example.com/bookshop");
      expect(findLinkUrl(doc, "apps-gate-play1")).toBe("https://example.com/googleplay");
      expect(findLinkUrl(doc, "map-gate-goog1")).toMatch(
        /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Okafor%20Studio%2012/,
      );
      expect(findLinkUrl(doc, "map-gate-appl1")).toMatch(/^https:\/\/maps\.apple\.com\/\?q=Okafor/);
      expect(findLinkUrl(doc, "book-gate-0001")).toBeNull();
    });

    it("a cover in another owner's folder is refused under the field cover, naming the block, and nothing is published", async () => {
      const o = await owner("bk2");
      const other = await owner("bk3");
      const foreign = `${other.userId}/img-0123456789ab.webp`;
      await writeBlocks(o, [book({ cover: { path: foreign, width: 800, height: 1200 } })]);
      const before = await publishedOf(admin, o.pageId);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      expect(result.ok === false && result.errors).toEqual([
        { blockId: "book-gate-0001", field: "cover", message: MESSAGE_FOREIGN },
      ]);
      expect(await publishedOf(admin, o.pageId)).toEqual(before);
    });

    it("a cover whose object is gone is refused with the 'no longer available' sentence", async () => {
      const o = await owner("bk4");
      const missing = `${o.userId}/img-${rand(12).padEnd(12, "b")}.webp`;
      await writeBlocks(o, [book({ cover: { path: missing, width: 800, height: 1200 } })]);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      expect(result.ok === false && result.errors).toEqual([
        { blockId: "book-gate-0001", field: "cover", message: MESSAGE_GONE },
      ]);
    });

    it("a hidden book is exempt: its cover is not checked and it is not published", async () => {
      const o = await owner("bk5");
      const other = await owner("bk6");
      await writeBlocks(o, [
        book({
          visible: false,
          title: "",
          cover: { path: `${other.userId}/img-0123456789ab.webp`, width: 8, height: 8 },
          links: [link("book-gate-amzn1", "kindle", "javascript:alert(1)")],
        }),
      ]);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: true });
      const { published } = await publishedOf(admin, o.pageId);
      expect(publishedDocSchema.parse(published).blocks).toEqual([]);
    });

    it("raw JSON abuse is refused at Publish with the fields named, and never reaches pages.published", async () => {
      const o = await owner("bk7");
      await writeBlocks(o, [
        book({
          links: [link("book-gate-amzn1", "evil", "data:text/html,x")],
        }),
        apps({
          links: [
            link("apps-gate-appl1", "huawei", "javascript:alert(1)"),
            link("apps-gate-play1", "googleplay", "//evil.example"),
          ],
        }),
        map({ googleId: "map-gate-same1", appleId: "map-gate-same1" }),
      ]);
      const before = await publishedOf(admin, o.pageId);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "invalid" });
      const errors = result.ok === false ? result.errors : [];
      const named = errors.map((e) => `${e.blockId}|${e.itemId ?? ""}|${e.field}`);
      expect(named).toEqual(
        expect.arrayContaining([
          "book-gate-0001|book-gate-amzn1|store",
          "book-gate-0001|book-gate-amzn1|url",
          "apps-gate-0001|apps-gate-appl1|store",
          "apps-gate-0001|apps-gate-appl1|url",
          "apps-gate-0001|apps-gate-play1|url",
        ]),
      );
      expect(errors.some((e) => e.message === "Ids must be unique within a page.")).toBe(true);
      expect(await publishedOf(admin, o.pageId)).toEqual(before);
    });

    it("a store link to a domain listed after the save stops Publish with the link's id and host; unlisting lets it through", async () => {
      const o = await owner("bk8");
      const late = `late-${rand(8)}.example`;
      await writeBlocks(o, [
        book({
          links: [
            link("book-gate-amzn1", "amazon"),
            link("book-gate-bad01", "bookshop", `https://www.${late}/x`),
          ],
        }),
        apps({ links: [link("apps-gate-play1", "googleplay", `https://play.${late}/app`)] }),
      ]);
      // Nothing listed yet: the save was fine and so is Publish.
      expect(await publish(o)).toMatchObject({ ok: true });
      const first = await publishedOf(admin, o.pageId);

      const listed = await admin.from("blocked_domains").insert({ domain: late, reason: "test" });
      expect(listed.error).toBeNull();
      domains.push(late);
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "blocked_link" });
      const errors = result.ok === false ? result.errors : [];
      expect(errors).toEqual([
        expect.objectContaining({
          blockId: "book-gate-0001",
          itemId: "book-gate-bad01",
          field: "url",
          host: `www.${late}`,
          message: "That site is blocked. Use a different link.",
        }),
        expect.objectContaining({
          blockId: "apps-gate-0001",
          itemId: "apps-gate-play1",
          field: "url",
          host: `play.${late}`,
        }),
      ]);
      // The live page is as it was.
      expect(await publishedOf(admin, o.pageId)).toEqual(first);
    });
  },
);
