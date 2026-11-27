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
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * Team access security re-review, finding 3 (M19-09, M19-10), through the real routes' cores: the
 * content writer notes who made a new entry (note_entry_creator), so an editor's trash of the OWNER's
 * never-published draft is on the owner's Members screen (the 30-day purge deletes it after), while
 * an editor's trash of their own never-live draft is still not recorded. The SQL rule is pgTAP 239.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("finding 3: a never-live draft trashed by someone else is recorded (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;
  // Imported in beforeAll: the route cores read the server env at import, which the unit step has not.
  let createPostCore: typeof import("@/lib/posts/routes-core").createPostCore;
  let postActionCore: typeof import("@/lib/posts/routes-core").postActionCore;
  let loadTeamCore: typeof import("@/lib/team/core").loadTeamCore;

  beforeAll(async () => {
    ({ createPostCore, postActionCore } = await import("@/lib/posts/routes-core"));
    ({ loadTeamCore } = await import("@/lib/team/core"));
    admin = adminClient() as SupabaseClient<Database>;
    adminMock.current = admin;
    f = await teamFixture(admin as never, "m19tn");
    await enablePost(admin, f.owner.pageId);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, fixtureUsers(f));
  });

  const draftBy = async (userId: string, title: string) => {
    const made = await createPostCore(admin as never, { userId, siteId: f.owner.pageId, title });
    expect(made.status).toBe(201);
    return (made.body as { id: string; rev: number }).id;
  };
  const trashAs = async (userId: string, entryId: string) => {
    const row = await admin.from("content_entries").select("rev").eq("id", entryId).single();
    const out = await postActionCore(admin as never, "trash", {
      userId,
      siteId: f.owner.pageId,
      entryId,
      expectedRev: Number(row.data!.rev),
    });
    expect(out.status).toBe(200);
  };
  /** The editor's trash rows on the owner's Members screen (the listing carries no entry id). */
  const editorTrashes = async () => {
    const team = await loadTeamCore(admin as never, { actorId: f.owner.userId, siteId: f.owner.pageId });
    return team!.activity.filter((a) => a.action === "entry_trashed" && a.email === f.editor.email);
  };

  it("an editor's trash of their own never-live draft is not recorded; of the owner's never-published draft it is", async () => {
    const own = await draftBy(f.editor.userId, "The editor's draft");
    await trashAs(f.editor.userId, own);
    expect(await editorTrashes()).toEqual([]);
    // The reviewer's scenario.
    const owners = await draftBy(f.owner.userId, "The owner's draft");
    await trashAs(f.editor.userId, owners);
    expect(await editorTrashes()).toEqual([expect.objectContaining({ role: "editor", times: 1 })]);
  });
});
