// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
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


/**
 * M19-06, M19-07 (T5, T15): the Posts routes' cores under team access. A Free member of a Studio site
 * sees the OWNER's posts limit; a post of another site named under S is missing; publish needs a
 * publisher; the blog's settings (types/post) are owner-only.
 */
const { run } = await stackIsUp();
// After stackIsUp: the route cores read the server env (.env.local) at import.
const { listTypesCore, createPostCore, getPostCore, postActionCore, setPostTypeCore, renameTermCore } =
  await import("@/lib/posts/routes-core");
const { PLAN_LIMITS } = await import("@/lib/limits/table");

describe.skipIf(!run)("M19-06 the Posts routes under team access (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;
  let other: TestOwner;

  beforeAll(async () => {
    admin = adminClient() as SupabaseClient<Database>;
    adminMock.current = admin;
    f = await teamFixture(admin as never, "m19r");
    other = await makeOwner(admin as never, "m19r-b");
    await enablePost(admin, f.owner.pageId);
    await enablePost(admin, other.pageId);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, [...fixtureUsers(f), other]);
  });

  it("M19-06 the limit shown to a Free editor is the Studio owner's (planOf reads access.plan)", async () => {
    const out = await listTypesCore(admin as never, { userId: f.editor.userId, siteId: f.owner.pageId });
    expect(out.status).toBe(200);
    expect((out.body as { usage: { limit: number } }).usage.limit).toBe(PLAN_LIMITS.studio.entriesPerType);
    expect(PLAN_LIMITS.free.entriesPerType).toBeLessThan(PLAN_LIMITS.studio.entriesPerType);
  });

  it("M19-06 an editor creates a post; publishing it is 403 forbidden; a publisher's is 200", async () => {
    const made = await createPostCore(admin as never, { userId: f.editor.userId, siteId: f.owner.pageId, title: "By editor" });
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    await admin.from("content_entries").update({ draft: { title: "By editor", slug: "by-editor", body: "x" } as never, rev: 2 }).eq("id", id);
    const refused = await postActionCore(admin as never, "publish", { userId: f.editor.userId, siteId: f.owner.pageId, entryId: id, expectedRev: 2 });
    expect(refused).toMatchObject({ status: 403, body: { kind: "forbidden" } });
    const ok = await postActionCore(admin as never, "publish", { userId: f.publisher.userId, siteId: f.owner.pageId, entryId: id, expectedRev: 2 });
    expect(ok.status).toBe(200);
  });

  it("M19-06 a post of another site named under S answers missing, for the member and the owner", async () => {
    const theirs = await createPostCore(admin as never, { userId: other.userId, siteId: other.pageId, title: "Theirs" });
    const id = (theirs.body as { id: string }).id;
    for (const who of [f.publisher, f.owner]) {
      expect(await getPostCore({ userId: who.userId, siteId: f.owner.pageId, entryId: id })).toMatchObject({ status: 404, body: { kind: "missing" } });
      expect(await postActionCore(admin as never, "trash", { userId: who.userId, siteId: f.owner.pageId, entryId: id, expectedRev: 1 })).toMatchObject({ status: 404 });
    }
    expect(await getPostCore({ userId: f.stranger.userId, siteId: f.owner.pageId, entryId: id })).toMatchObject({ status: 404 });
  });

  it("M19-07 the blog's settings and a term rename by an editor are refused", async () => {
    for (const who of [f.editor, f.publisher]) {
      const out = await setPostTypeCore({ userId: who.userId, siteId: f.owner.pageId, enabled: false, archivePath: undefined });
      expect(out.status, who.email).toBe(404);
    }
    const type = await admin.from("content_types").select("enabled").eq("site_id", f.owner.pageId).eq("key", "post").single();
    expect(type.data!.enabled).toBe(true);
    const term = await admin.from("content_terms").insert({
      site_id: f.owner.pageId,
      type_id: (await admin.from("content_types").select("id").eq("site_id", f.owner.pageId).eq("key", "post").single()).data!.id,
      taxonomy: "tag", slug: "t-m19r", name: "T",
    }).select("id").single();
    const renamed = await renameTermCore({ userId: f.editor.userId, siteId: f.owner.pageId, termId: term.data!.id, name: "Nope" } as never);
    expect(renamed.status).toBe(403);
  });
});
