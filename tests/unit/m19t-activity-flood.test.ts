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
 * Team access attack pass, finding 2 (M19-09, M19-10): the attacker's repro, a member toggling trash
 * and restore of a live post as fast as the routes answer. With the real limiter (Postgres) and the
 * real activity function: past 30 recorded changes a minute the routes answer 429 with the limit's
 * sentence and change nothing; the toggles that went through are two rows with counts, not dozens;
 * the owner's Members screen still lists the publish.
 */
const { run } = await stackIsUp();

describe.skipIf(!run)("finding 2: a member cannot flood the activity log (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;
  // Imported in beforeAll: the route cores read the server env at import, which the unit step has not.
  let createPostCore: typeof import("@/lib/posts/routes-core").createPostCore;
  let postActionCore: typeof import("@/lib/posts/routes-core").postActionCore;
  let loadTeamCore: typeof import("@/lib/team/core").loadTeamCore;
  let SITE_ACTIVITY_RATE_LIMIT: typeof import("@/lib/team/activity-limit").SITE_ACTIVITY_RATE_LIMIT;
  let SITE_ACTIVITY_RATE_LIMITED: typeof import("@/lib/team/activity-limit").SITE_ACTIVITY_RATE_LIMITED;

  beforeAll(async () => {
    ({ createPostCore, postActionCore } = await import("@/lib/posts/routes-core"));
    ({ loadTeamCore } = await import("@/lib/team/core"));
    ({ SITE_ACTIVITY_RATE_LIMIT, SITE_ACTIVITY_RATE_LIMITED } = await import("@/lib/team/activity-limit"));
    admin = adminClient() as SupabaseClient<Database>;
    adminMock.current = admin;
    f = await teamFixture(admin as never, "m19fl");
    await enablePost(admin, f.owner.pageId);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, fixtureUsers(f));
  });

  it("the 31st change in a minute is 429; the log holds one row per action with its count", async () => {
    const site = f.owner.pageId;
    const made = await createPostCore(admin as never, { userId: f.owner.userId, siteId: site, title: "Live" });
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    await admin.from("content_entries").update({ draft: { title: "Live", slug: "live", body: "x" } as never, rev: 2 }).eq("id", id);
    const live = await postActionCore(admin as never, "publish", { userId: f.owner.userId, siteId: site, entryId: id, expectedRev: 2 });
    expect(live.status).toBe(200);
    let rev = (live.body as { rev: number }).rev;

    const statuses: number[] = [];
    let refusal: unknown = null;
    for (let i = 0; i < SITE_ACTIVITY_RATE_LIMIT + 5; i++) {
      // Past the limit the post stays where the last change left it (live), so each try is a trash.
      const action = i >= SITE_ACTIVITY_RATE_LIMIT || i % 2 === 0 ? "trash" : "restore";
      const out = await postActionCore(admin as never, action, {
        userId: f.publisher.userId,
        siteId: site,
        entryId: id,
        expectedRev: rev,
      });
      statuses.push(out.status);
      if (out.status === 200) rev = (out.body as { rev: number }).rev;
      else refusal ??= out.body;
    }
    expect(statuses.slice(0, SITE_ACTIVITY_RATE_LIMIT)).toEqual(Array(SITE_ACTIVITY_RATE_LIMIT).fill(200));
    expect(statuses.slice(SITE_ACTIVITY_RATE_LIMIT)).toEqual(Array(5).fill(429));
    expect(refusal).toEqual({ kind: "limit", message: SITE_ACTIVITY_RATE_LIMITED });

    // The team schema is not exposed to the API: the rows are read through the owner's own listing.
    const team = await loadTeamCore(admin as never, { actorId: f.owner.userId, siteId: site });
    const toggles = team!.activity.filter((a) => a.action === "entry_trashed" || a.action === "entry_restored");
    expect(toggles).toHaveLength(2);
    expect(toggles.reduce((sum, a) => sum + a.times, 0)).toBe(SITE_ACTIVITY_RATE_LIMIT);
    expect(team!.activity.some((a) => a.action === "post_published")).toBe(true);
  });
});
