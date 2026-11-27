// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { removeOwners, stackIsUp } from "./publish-support";
import { adminClient } from "./m17f-forms-db-support";
import { enablePost } from "./content-support";
import { fixtureUsers, teamFixture, type TeamFixture } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({
  invalidatePage: vi.fn(),
  invalidateEntry: vi.fn(),
  invalidateType: vi.fn(),
}));
const adminMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => adminMock.current }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const { createEntryWithClient } = await import("@/lib/content/entries-core");
const { publishEntryWithClient } = await import("@/lib/content/publish-core");
const { trashEntryWithClient } = await import("@/lib/content/trash-core");
const { createSubPageWithClient, deleteSubPageWithClient } = await import("@/lib/site-pages/sub-pages-core");

/**
 * R8 (M19-07, G17): an editor's trash or delete is decided from a row the core read first. A
 * publisher who publishes the entry in between must win: the database decides again on the locked
 * row through the rule (trash_entry_as, delete_page_entry_as), so the editor gets `forbidden` and the
 * entry stays live. The race is made deterministic: the client publishes the entry the moment the
 * core calls the takedown function, after its own read.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("R8 a takedown is decided on the locked row (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;

  beforeAll(async () => {
    admin = adminClient() as SupabaseClient<Database>;
    adminMock.current = admin;
    f = await teamFixture(admin as never, "m19r8");
    await enablePost(admin, f.owner.pageId);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, fixtureUsers(f));
  });

  /** The admin client, with `before` run just before the named rpc (the publisher's publish). */
  const racing = (fn: string, before: () => Promise<void>) =>
    new Proxy(admin, {
      get(target, prop, receiver) {
        if (prop !== "rpc") return Reflect.get(target, prop, receiver);
        return async (name: string, args: unknown) => {
          if (name === fn) await before();
          return target.rpc(name as never, args as never);
        };
      },
    }) as SupabaseClient<Database>;

  it("an editor's trash of a draft post that a publisher publishes in between is refused; the post stays live", async () => {
    const made = await createEntryWithClient(admin, {
      actor: { userId: f.editor.userId, source: "editor" },
      siteId: f.owner.pageId,
      typeKey: "post",
      draft: { title: "Race", slug: `race-${Date.now()}`, body: "Hi" },
    });
    if (!made.ok) throw new Error(made.error);
    let rev = made.rev;
    const client = racing("trash_entry_as", async () => {
      const out = await publishEntryWithClient(admin, {
        actor: { userId: f.publisher.userId, source: "editor" },
        entryId: made.id,
        expectedRev: made.rev,
      });
      if (!out.ok) throw new Error(`publish: ${out.error}`);
      rev = out.rev;
    });
    const trashed = await trashEntryWithClient(client, {
      actor: { userId: f.editor.userId, source: "editor" },
      entryId: made.id,
      expectedRev: made.rev,
    });
    expect(trashed).toMatchObject({ ok: false, error: "forbidden", status: 403 });
    const row = await admin.from("content_entries").select("published, deleted_at, rev").eq("id", made.id).single();
    expect(row.data).toMatchObject({ deleted_at: null, rev });
    expect(row.data!.published).not.toBeNull();
  });

  it("an editor's delete of a draft page that a publisher publishes in between is refused; the page stays", async () => {
    const page = await createSubPageWithClient(admin as never, {
      userId: f.editor.userId,
      source: "editor",
      siteId: f.owner.pageId,
      title: "Racing page",
      path: "racing-page",
    });
    if (!page.ok) throw new Error(page.error);
    const client = racing("delete_page_entry_as", async () => {
      const live = await admin
        .from("content_entries")
        .update({
          published: { path: "racing-page", title: "Racing page", description: "", blocks: [] } as never,
          published_at: new Date().toISOString(),
        })
        .eq("id", page.id)
        .select("id");
      expect(live.data).toHaveLength(1);
    });
    const deleted = await deleteSubPageWithClient(client as never, {
      userId: f.editor.userId,
      siteId: f.owner.pageId,
      subPageId: page.id,
    });
    expect(deleted).toMatchObject({ ok: false, error: "forbidden" });
    expect((await admin.from("content_entries").select("id").eq("id", page.id)).data).toHaveLength(1);
  });

  it("without a race the editor still trashes a draft", async () => {
    const made = await createEntryWithClient(admin, {
      actor: { userId: f.editor.userId, source: "editor" },
      siteId: f.owner.pageId,
      typeKey: "post",
      draft: { title: "Plain", slug: `plain-${Date.now()}`, body: "Hi" },
    });
    if (!made.ok) throw new Error(made.error);
    expect(
      await trashEntryWithClient(admin, {
        actor: { userId: f.editor.userId, source: "editor" },
        entryId: made.id,
        expectedRev: made.rev,
      }),
    ).toMatchObject({ ok: true });
  });
});
