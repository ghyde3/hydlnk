// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { removeOwners, stackIsUp } from "./publish-support";
import { adminClient, signIn } from "./m17f-forms-db-support";
import { enablePost } from "./content-support";
import { fixtureUsers, teamFixture, type TeamFixture } from "./m19t-team-support";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage: vi.fn(), invalidateEntry: vi.fn(), invalidateType: vi.fn() }));
const adminMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => adminMock.current }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/**
 * M19-16 (T9, T21, G3, G19, G21): forms and schedules under team access, on the local stack.
 *   * a member reads no form submission of the shared site and deletes none; the counts are empty;
 *   * a publisher schedules a post (created_by is the publisher); an editor's request is forbidden;
 *   * the worker's one actor check passes the publisher and the owner, and after the publisher is
 *     removed the row is canceled and would end access_lost at fire; the owner's rows are untouched.
 */
const { run } = await stackIsUp();
const { scheduleEntryWithClient } = await import("@/lib/content/schedule-core");
const { scheduleActorRefusal } = await import("@/lib/schedule/worker");

describe.skipIf(!run)("M19-16 forms and schedules under team access (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;
  const as = (userId: string) => ({ userId, source: "editor" as const });
  const later = () => {
    const at = new Date(Date.now() + 3 * 86_400_000);
    at.setUTCSeconds(0, 0);
    return at.toISOString().slice(0, 16) + ":00Z";
  };

  beforeAll(async () => {
    admin = adminClient() as SupabaseClient<Database>;
    adminMock.current = admin;
    f = await teamFixture(admin as never, "m19fs");
    await enablePost(admin, f.owner.pageId);
    await admin.from("pages").update({ published: { version: 1, blocks: [] } as never, published_at: new Date().toISOString() }).eq("id", f.owner.pageId);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, fixtureUsers(f));
  });

  it("M19-16 a member reads no form submission, deletes none, and the counts are empty", async () => {
    const recorded = await admin.rpc("record_form_submission", {
      p_site_id: f.owner.pageId, p_block_id: "formSignup01", p_entry_id: null as unknown as string,
      p_kind: "signup", p_email: "fan-m19@example.com", p_name: null as unknown as string, p_message: null as unknown as string,
    });
    expect(recorded.error).toBeNull();
    for (const member of [f.editor, f.publisher]) {
      const client = await signIn(admin as never, member);
      const rows = await client.from("form_submissions").select("id").eq("site_id", f.owner.pageId);
      expect(rows.data ?? []).toEqual([]);
      const deleted = await client.from("form_submissions").delete().eq("site_id", f.owner.pageId).select("id");
      expect(deleted.data ?? []).toEqual([]);
      const counts = await client.rpc("form_submission_counts", { p_site_id: f.owner.pageId });
      expect(counts.error).toBeNull();
      expect(counts.data).toEqual([]);
    }
    const still = await admin.from("form_submissions").select("id").eq("site_id", f.owner.pageId);
    expect(still.data).toHaveLength(1);
  });

  it("M19-16 a publisher schedules; an editor is refused; removal cancels the publisher's rows only", async () => {
    const post = async (title: string) => {
      const made = await admin.from("content_entries").insert({
        site_id: f.owner.pageId,
        type_id: (await admin.from("content_types").select("id").eq("site_id", f.owner.pageId).eq("key", "post").single()).data!.id,
        draft: { title, slug: title.toLowerCase(), body: "Hi" } as never,
      }).select("id, rev").single();
      return made.data!;
    };
    const mine = await post("Mine");
    const ownerRow = await post("Owners");
    const editorTry = await scheduleEntryWithClient(admin, { actor: as(f.editor.userId), entryId: mine.id, expectedRev: Number(mine.rev), action: "publish", runAt: later() });
    expect(editorTry).toMatchObject({ ok: false, error: "forbidden" });
    const byPublisher = await scheduleEntryWithClient(admin, { actor: as(f.publisher.userId), entryId: mine.id, expectedRev: Number(mine.rev), action: "publish", runAt: later() });
    expect(byPublisher.ok, JSON.stringify(byPublisher)).toBe(true);
    const byOwner = await scheduleEntryWithClient(admin, { actor: as(f.owner.userId), entryId: ownerRow.id, expectedRev: Number(ownerRow.rev), action: "publish", runAt: later() });
    expect(byOwner.ok).toBe(true);
    const rows = await admin.from("content_schedules").select("entry_id, created_by, status").eq("site_id", f.owner.pageId);
    expect(rows.data!.find((r) => r.entry_id === mine.id)?.created_by).toBe(f.publisher.userId);

    const claimed = (createdBy: string) => ({ action: "publish" as const, siteId: f.owner.pageId, ownerId: f.owner.userId, createdBy });
    expect(await scheduleActorRefusal(admin, claimed(f.publisher.userId))).toBeNull();
    expect(await scheduleActorRefusal(admin, claimed(f.owner.userId))).toBeNull();
    expect(await scheduleActorRefusal(admin, claimed(f.editor.userId))).toBe("access_lost");
    expect(await scheduleActorRefusal(admin, claimed(f.stranger.userId))).toBe("access_lost");

    await admin.rpc("remove_site_member", { p_site: f.owner.pageId, p_actor: f.owner.userId, p_user: f.publisher.userId });
    const after = await admin.from("content_schedules").select("entry_id, status, result_code").eq("site_id", f.owner.pageId);
    expect(after.data!.find((r) => r.entry_id === mine.id)).toMatchObject({ status: "canceled", result_code: "canceled" });
    expect(after.data!.find((r) => r.entry_id === ownerRow.id)).toMatchObject({ status: "pending" });
    expect(await scheduleActorRefusal(admin, claimed(f.publisher.userId))).toBe("access_lost");
  });
});
