import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Block } from "@/lib/document";
import { draftOf, makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * 1b1-15: whole-site Publish reads Home's blocks and the sub-pages from page entries and the design
 * from pages.draft (its frozen blocks are never read), against the local Supabase.
 */

const link = (id: string, label = "Book", url = "https://example.com/book"): Block => ({
  id,
  type: "link",
  visible: true,
  label,
  url,
});

const { run } = await stackIsUp();

describe.skipIf(!run)("1b1-15 publishPageCore over page entries (local Supabase)", () => {
  let admin: SupabaseClient;
  let core: typeof import("@/lib/publish/core");
  const owners: TestOwner[] = [];
  const homes = new Map<string, string>();

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

  const addEntry = async (siteId: string, draft: object) => {
    const type = await admin
      .from("content_types")
      .select("id")
      .eq("site_id", siteId)
      .eq("key", "page")
      .single();
    const { data, error } = await admin
      .from("content_entries")
      .insert({ site_id: siteId, type_id: type.data!.id, draft: draft as never })
      .select("id")
      .single();
    expect(error).toBeNull();
    return data!.id as string;
  };
  /**
   * A site whose Home entry holds `blocks` and whose pages.draft holds a stale frozen block (set
   * while the site has no Home entry, as a site not yet moved would have it).
   */
  const owner = async (
    label: string,
    blocks: Block[],
    withHome = true,
    plan: "free" | "pro" = "free",
  ) => {
    // The frozen blocks of pages.draft differ from the entry's on purpose.
    const made = await makeOwner(
      admin,
      label,
      () => draftOf("Alpha", [link("frozen-link-01", "Frozen")]),
      plan,
    );
    owners.push(made);
    if (withHome) {
      homes.set(
        made.pageId,
        await addEntry(made.pageId, { path: "/", title: "", description: "", blocks }),
      );
    }
    return made;
  };
  const sub = (o: TestOwner, title: string, path: string, blocks: Block[] = []) =>
    addEntry(o.pageId, { path, title, description: "About it.", blocks });
  const publish = (o: TestOwner, adminClient: SupabaseClient = admin) =>
    core.publishPageCore({ pageId: o.pageId, userId: o.userId }, { admin: adminClient });
  const entry = async (id: string) =>
    (await admin.from("content_entries").select("published, rev").eq("id", id).single()).data!;
  const pageRow = async (o: TestOwner) =>
    (await admin.from("pages").select("published, draft").eq("id", o.pageId).single()).data!;

  it("publishes Home's entry blocks, never the frozen blocks of pages.draft", async () => {
    const o = await owner("pe1", [link("home-link-001", "Entry")]);
    const a = await sub(o, "Items", "items", [link("a-link-00001")]);
    expect(await publish(o)).toMatchObject({ ok: true });
    const home = await entry(homes.get(o.pageId)!);
    expect((home.published as { blocks: { id: string; label: string }[] }).blocks).toEqual([
      expect.objectContaining({ id: "home-link-001", label: "Entry" }),
    ]);
    expect(((await entry(a)).published as { path: string }).path).toBe("items");
    // The row's own blocks are the frozen copy; the design half is published.
    const row = await pageRow(o);
    expect((row.published as { profile: { name: string } }).profile.name).toBe("Alpha");
  });

  it("an edit of Home's entry and of a sub-page both go live at the next Publish", async () => {
    const o = await owner("pe2", [link("home-link-001", "One")]);
    const a = await sub(o, "Items", "items", [link("a-link-00001", "First")]);
    expect(await publish(o)).toMatchObject({ ok: true });
    await admin
      .from("content_entries")
      .update({
        draft: { path: "/", title: "", description: "", blocks: [link("home-link-001", "Two")] },
      })
      .eq("id", homes.get(o.pageId)!);
    await admin
      .from("content_entries")
      .update({
        draft: {
          path: "items",
          title: "Items",
          description: "",
          blocks: [link("a-link-00001", "Second")],
        },
      })
      .eq("id", a);
    expect(await publish(o)).toMatchObject({ ok: true });
    const blocksOf = (v: unknown) => (v as { blocks: { label: string }[] }).blocks[0]!.label;
    expect(blocksOf((await entry(homes.get(o.pageId)!)).published)).toBe("Two");
    expect(blocksOf((await entry(a)).published)).toBe("Second");
  });

  it("a broken Home entry gives the same issue a broken Home draft gave, naming the block", async () => {
    const o = await owner("pe3", [link("home-link-001", "")]);
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({ blockId: "home-link-001", field: "label" }),
    ]);
    expect(result.errors[0]!.subPageId).toBeUndefined();
    expect((await entry(homes.get(o.pageId)!)).published).toBeNull();
  });

  it("a blocklisted link in Home's entry refuses the publish", async () => {
    const domain = `blocked-${Math.random().toString(36).slice(2, 8)}.example`;
    const o = await owner("pe4", [link("home-link-001", "Bad", `https://${domain}/x`)]);
    await admin.from("blocked_domains").insert({ domain, reason: "test" });
    try {
      const result = await publish(o);
      expect(result).toMatchObject({ ok: false, reason: "blocked_link" });
      expect((await entry(homes.get(o.pageId)!)).published).toBeNull();
    } finally {
      await admin.from("blocked_domains").delete().eq("domain", domain);
    }
  });

  it("a block id shared by Home's entry and a sub-page is refused on the sub-page", async () => {
    const o = await owner("pe5", [link("dup-link-0001")]);
    await sub(o, "Items", "items", [link("dup-link-0001")]);
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ blockId: "dup-link-0001", pageTitle: "Items" });
  });

  it("Home is never listed as a sub-page: a menu entry pointing at Home's entry id is dropped", async () => {
    const o = await owner("pe6", [link("home-link-001")]);
    const a = await sub(o, "Items", "items");
    const homeId = homes.get(o.pageId)!;
    const stored = (await pageRow(o)).draft as object;
    const design = { ...stored, nav: { show: true, items: [homeId, a] } };
    const saved = await admin
      .from("pages")
      .update({ draft: design as never })
      .eq("id", o.pageId);
    expect(saved.error).toBeNull();
    expect(await publish(o)).toMatchObject({ ok: true });
    expect((await pageRow(o)).published).toMatchObject({ nav: { show: true, items: [a] } });
  });

  it("a page added between the read and the write is a retryable set mismatch, nothing written", async () => {
    const o = await owner("pe7", [link("home-link-001")], true, "pro");
    await sub(o, "Items", "items");
    let raced = false;
    const racing = new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "rpc") return Reflect.get(target, prop, receiver);
        return async (...args: Parameters<typeof admin.rpc>) => {
          if (!raced) {
            raced = true;
            await sub(o, "Late", "late");
          }
          return target.rpc(...args);
        };
      },
    });
    const result = await publish(o, racing);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(result.errors[0]!.message).toContain("changed while publishing");
    expect((await entry(homes.get(o.pageId)!)).published).toBeNull();
    // Publishing again sees the site as it is now.
    expect(await publish(o)).toMatchObject({ ok: true });
  });

  it("a site with no Home entry is refused without writing", async () => {
    const o = await owner("pe8", [], false);
    const a = await sub(o, "Items", "items");
    const result = await publish(o);
    expect(result).toMatchObject({ ok: false, reason: "error" });
    expect((await entry(a)).published).toBeNull();
    expect((await pageRow(o)).published).toBeNull();
  });

  it("Unpublish takes Home's entry and every sub-page entry offline, with no code change", async () => {
    const o = await owner("pe9", [link("home-link-001")]);
    const a = await sub(o, "Items", "items", [link("a-link-00001")]);
    expect(await publish(o)).toMatchObject({ ok: true });
    expect((await entry(a)).published).not.toBeNull();
    const { unpublishSiteCore } = await import("@/lib/publish/unpublish");
    const out = await unpublishSiteCore({ pageId: o.pageId, userId: o.userId }, { admin });
    expect(out).toMatchObject({ ok: true });
    expect((await entry(homes.get(o.pageId)!)).published).toBeNull();
    expect((await entry(a)).published).toBeNull();
    expect((await pageRow(o)).published).toBeNull();
  });
});
