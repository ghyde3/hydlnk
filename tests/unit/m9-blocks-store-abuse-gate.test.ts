import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/document";
import {
  draftOf,
  makeOwner,
  publishedOf,
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

// Database round trips: a loaded machine can take far longer than 5 seconds.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M9-21 and M9-22 abuse cases through the real Publish gate (`publishPageCore`, local Supabase):
 * drafts written as raw JSON straight into `pages.draft`, the way a client with the publishable key
 * and the owner's JWT could. Each is refused with the field named, and `pages.published` and
 * `published_at` stay exactly as they were (the cache tag is never touched either: the gate returns
 * before any write, and `updateTag` belongs to the Server Action).
 */
const { run } = await stackIsUp();

const map = (extra: Record<string, unknown> = {}): Block =>
  ({
    id: "map-abuse-00001",
    type: "map",
    visible: true,
    name: "Okafor Studio",
    address: "12 Canal Street",
    googleId: "map-abuse-goog1",
    appleId: "map-abuse-appl1",
    ...extra,
  }) as Block;
const apps = (links: unknown[], extra: Record<string, unknown> = {}): Block =>
  ({ id: "apps-abuse-00001", type: "apps", visible: true, links, ...extra }) as Block;
const header: Block = {
  id: "head-abuse-0001",
  type: "header",
  visible: true,
  text: "Hello",
} as Block;

describe.skipIf(!run)("M9-21/22 the Publish gate refuses raw-JSON abuse (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false },
    });
    core = await import("@/lib/publish/core");
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  /** A user with a live page (so "unchanged" means something), then `blocks` written as the draft. */
  async function refused(label: string, blocks: Block[]) {
    const o = await makeOwner(admin, label, (handle) => draftOf(handle, [header]));
    owners.push(o);
    const first = await core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
    expect(first.ok).toBe(true);
    const before = await publishedOf(admin, o.pageId);
    const { error } = await admin
      .from("pages")
      .update({ draft: draftOf("Alpha", blocks) as never })
      .eq("id", o.pageId);
    expect(error).toBeNull();
    const result = await core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin });
    expect(await publishedOf(admin, o.pageId)).toEqual(before);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    return result.ok === false ? result.errors : [];
  }

  it("a map whose two ids are equal is refused: 'Ids must be unique within a page.'", async () => {
    const errors = await refused("ma1", [map({ appleId: "map-abuse-goog1" })]);
    expect(errors).toEqual([
      expect.objectContaining({
        blockId: "map-abuse-00001",
        field: "appleId",
        message: "Ids must be unique within a page.",
      }),
    ]);
  });

  it("a map whose googleId is the id of a link block, or of another map's button, is refused", async () => {
    const link = {
      id: "link-abuse-0001",
      type: "link",
      visible: true,
      label: "Link",
      url: "https://example.com/",
    } as Block;
    const clash = await refused("ma2", [link, map({ googleId: "link-abuse-0001" })]);
    expect(clash.map((e) => [e.blockId, e.field, e.message])).toEqual([
      ["map-abuse-00001", "googleId", "Ids must be unique within a page."],
    ]);
    const twoMaps = await refused("ma3", [
      map(),
      map({ id: "map-abuse-00002", googleId: "map-abuse-goog2", appleId: "map-abuse-appl1" }),
    ]);
    expect(twoMaps.map((e) => [e.blockId, e.field])).toEqual([["map-abuse-00002", "appleId"]]);
  });

  it("an id with a slash, a space or the wrong length is refused with the id rule's sentence", async () => {
    for (const [index, id] of [
      "map/slash/id-01",
      "has space 0001",
      "short",
      "x".repeat(25),
    ].entries()) {
      const errors = await refused(`ma4${index}`, [map({ appleId: id })]);
      expect(errors, id).toEqual([
        expect.objectContaining({
          blockId: "map-abuse-00001",
          field: "appleId",
          message: "Ids are 8-24 letters, digits, _ or -.",
        }),
      ]);
    }
  });

  it("a map with an empty name and address is named field by field, a line break in the address is refused", async () => {
    const empty = await refused("ma5", [map({ name: "", address: "" })]);
    expect(empty.map((e) => [e.field, e.message])).toEqual([
      ["name", "Add a place name."],
      ["address", "Add an address."],
    ]);
    const breaks = await refused("ma6", [map({ address: "12 Canal Street\n</p><script>" })]);
    expect(breaks).toEqual([
      expect.objectContaining({ blockId: "map-abuse-00001", field: "address" }),
    ]);
  });

  it("an app store block with store 'huawei', javascript:, //host or a 5,000-character address names each badge", async () => {
    const errors = await refused("ap1", [
      apps([
        { id: "apps-abuse-lnk01", store: "huawei", url: "https://example.com/ok" },
        { id: "apps-abuse-lnk02", store: "appstore", url: "javascript:alert(1)" },
      ]),
      apps(
        [
          { id: "apps-abuse-lnk03", store: "appstore", url: "//evil.example" },
          {
            id: "apps-abuse-lnk04",
            store: "googleplay",
            url: `https://example.com/${"a".repeat(5000)}`,
          },
        ],
        { id: "apps-abuse-00002" },
      ),
    ]);
    const named = errors.map((e) => `${e.blockId}|${e.itemId}|${e.field}`).sort();
    expect(named).toEqual(
      [
        "apps-abuse-00001|apps-abuse-lnk01|store",
        "apps-abuse-00001|apps-abuse-lnk02|url",
        "apps-abuse-00002|apps-abuse-lnk03|url",
        "apps-abuse-00002|apps-abuse-lnk04|url",
      ].sort(),
    );
  });

  it("a third badge and a repeated store are refused, and a block with no link at all says 'Add at least one store link.'", async () => {
    const three = await refused("ap2", [
      apps([
        { id: "apps-abuse-lnk01", store: "appstore", url: "https://example.com/1" },
        { id: "apps-abuse-lnk02", store: "googleplay", url: "https://example.com/2" },
        { id: "apps-abuse-lnk03", store: "appstore", url: "https://example.com/3" },
      ]),
    ]);
    expect(three.map((e) => e.message)).toContain("You can add up to 2 stores.");
    const repeat = await refused("ap3", [
      apps([
        { id: "apps-abuse-lnk01", store: "appstore", url: "https://example.com/1" },
        { id: "apps-abuse-lnk02", store: "appstore", url: "https://example.com/2" },
      ]),
    ]);
    expect(repeat).toEqual([
      expect.objectContaining({
        itemId: "apps-abuse-lnk02",
        field: "store",
        message: "Each store can be added once.",
      }),
    ]);
    const none = await refused("ap4", [apps([])]);
    expect(none).toEqual([
      expect.objectContaining({
        blockId: "apps-abuse-00001",
        field: "links",
        message: "Add at least one store link.",
      }),
    ]);
  });
});
