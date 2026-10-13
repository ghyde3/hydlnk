// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import {
  draftOf,
  makeOwner,
  moveHome,
  removeOwners,
  stackIsUp,
  type TestOwner,
} from "./publish-support";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: async () => mocks.client }));

const { run } = await stackIsUp();

/**
 * 1b1-17 (M15-05): the editor's loaders read Home's blocks and the sub-pages from page entries, with
 * the owner's own session under RLS, and carry the entry ids and revs the autosave needs. The design
 * still comes from pages.draft; its frozen `blocks` are never read.
 */
describe.skipIf(!run)("editor loaders on page entries", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  let owner: TestOwner;
  let homeId: string;
  let typeId: string;
  let subId: string;
  let trashedId: string;
  const frozen = draftOf("Frozen name").blocks;
  const live = [
    {
      id: "lnk-bbbbbbbb",
      type: "link",
      visible: true,
      label: "Live",
      url: "https://example.com/l",
    },
  ];

  beforeAll(async () => {
    owner = await makeOwner(admin as never, "ld", (handle) => draftOf(handle));
    owners.push(owner);
    homeId = await moveHome(admin as never, owner.pageId);
    // The entry moves on; the frozen copy in pages.draft stays as it was.
    const edited = await admin
      .from("content_entries")
      .update({ draft: { path: "/", title: "", description: "", blocks: live } as never })
      .eq("id", homeId);
    if (edited.error) throw new Error(edited.error.message);
    typeId = (
      await admin
        .from("content_types")
        .select("id")
        .eq("site_id", owner.pageId)
        .eq("key", "page")
        .single()
    ).data!.id;
    const sub = await admin
      .from("content_entries")
      .insert({
        site_id: owner.pageId,
        type_id: typeId,
        draft: { path: "about", title: "About", description: "d", blocks: [] } as never,
      })
      .select("id")
      .single();
    if (sub.error) throw new Error(sub.error.message);
    subId = sub.data.id;
    const trashed = await admin
      .from("content_entries")
      .insert({
        site_id: owner.pageId,
        type_id: typeId,
        draft: { path: "gone", title: "Gone", description: "", blocks: [] } as never,
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (trashed.error) throw new Error(trashed.error.message);
    trashedId = trashed.data.id;

    // The owner's own session (a magic-link token, no password), so RLS decides every read.
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: owner.email });
    if (link.error) throw new Error(link.error.message);
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    const verified = await client.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: "magiclink",
    });
    if (verified.error) throw new Error(verified.error.message);
    mocks.client = client;
  });

  afterAll(async () => {
    if (run) await removeOwners(admin as never, owners);
  });

  it("Home's blocks come from the '/' entry, with its id and rev; the design from pages.draft", async () => {
    const { loadEditorPageData } = await import("@/lib/editor/page-data");
    const data = await loadEditorPageData({ id: owner.pageId, handle: owner.handle }, owner.userId);
    expect(frozen[0]!.id).not.toBe(live[0]!.id);
    expect(data.draft.blocks.map((b) => b.id)).toEqual(["lnk-bbbbbbbb"]);
    expect(data.draft.profile.name).toBe(owner.handle);
    expect(data.home).toEqual({ entryId: homeId, rev: expect.any(Number) });
    expect(data.home!.rev).toBeGreaterThanOrEqual(1);
    // The design's rev is still pages.draft's own, unrelated to the entry's.
    expect(data.revKey).toBe("1");
  });

  it("a site with no Home entry loads pages.draft whole and has no home ref", async () => {
    const bare = await makeOwner(admin as never, "ld0", (handle) => draftOf(handle));
    owners.push(bare);
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: bare.email });
    const client = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false } },
    );
    await client.auth.verifyOtp({
      token_hash: link.data!.properties!.hashed_token,
      type: "magiclink",
    });
    const previous = mocks.client;
    mocks.client = client;
    try {
      const { loadEditorPageData } = await import("@/lib/editor/page-data");
      const data = await loadEditorPageData({ id: bare.pageId, handle: bare.handle }, bare.userId);
      expect(data.home).toBeNull();
      expect(data.draft.blocks.map((b) => b.id)).toEqual(frozen.map((b) => b.id));
    } finally {
      mocks.client = previous;
    }
  });

  it("the sub-pages are the live entries with id, draft, rev and path; the trash is left out", async () => {
    const { loadSubPages } = await import("@/lib/site-pages/load");
    const pages = await loadSubPages(owner.pageId);
    expect(pages.map((p) => p.id)).toEqual([subId]);
    expect(pages.map((p) => p.id)).not.toContain(trashedId);
    expect(pages.map((p) => p.id)).not.toContain(homeId);
    const about = pages[0]!;
    expect(about.draft).toMatchObject({ path: "about", title: "About", description: "d" });
    expect(about.rev).toBeGreaterThanOrEqual(1);
    expect(about.published).toBeNull();
    expect(about.livePath).toBeNull();
    expect(typeof about.createdAt).toBe("string");
  });
});
