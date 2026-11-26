// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { removeOwners, stackIsUp, makeOwner, type TestOwner } from "./publish-support";
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

const { createEntryWithClient, updateEntryWithClient } = await import("@/lib/content/entries-core");
const { publishEntryWithClient, unpublishEntryWithClient } = await import("@/lib/content/publish-core");
const { trashEntryWithClient, restoreEntryWithClient, purgeEntryWithClient } = await import("@/lib/content/trash-core");
const { createTermWithClient, renameTermWithClient, deleteTermWithClient, listTermsWithClient } =
  await import("@/lib/content/terms-core");
const { enableTypeWithClient, listTypesWithClient } = await import("@/lib/content/types-core");
const { getEntryWithClient } = await import("@/lib/content/query-core");
const { scheduleEntryWithClient } = await import("@/lib/content/schedule-core");
const { createSubPageWithClient, deleteSubPageWithClient } = await import("@/lib/site-pages/sub-pages-core");

/**
 * M19-06 (T4, T5, T15): the content writer and the sub-page core ask the one access helper. Four
 * actors on the Studio owner's site S: the owner's results are unchanged, an editor edits, publish-
 * class operations need a publisher, a stranger gets the same not_found as a missing id, an entry or
 * term of another site named under S's id is not_found, and a publisher's body image must sit in the
 * OWNER's folder.
 */
const { run } = await stackIsUp();
// After stackIsUp: these read the public env (.env.local) at import.
const { storageUrl } = run ? await import("@/lib/media/url") : { storageUrl: (p: string) => p };
const { MEDIA_BUCKET } = await import("@/lib/media/limits");

describe.skipIf(!run)("M19-06 the content writer under team access (local Supabase)", () => {
  let admin: SupabaseClient<Database>;
  let f: TeamFixture;
  let other: TestOwner;
  const as = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });
  const MISSING = "11111111-1111-4111-8111-111111111111";

  beforeAll(async () => {
    admin = adminClient() as SupabaseClient<Database>;
    adminMock.current = admin;
    f = await teamFixture(admin as never, "m19c");
    other = await makeOwner(admin as never, "m19c-b", undefined, "studio");
    await enablePost(admin, f.owner.pageId);
    await enablePost(admin, other.pageId);
  });
  afterAll(async () => {
    if (f) await removeOwners(admin as never, [...fixtureUsers(f), other]);
  });

  const post = async (who: TestOwner, draft: Record<string, unknown> = { title: "T", slug: `s-${Math.random().toString(36).slice(2, 8)}`, body: "Hi" }, siteId = f.owner.pageId) =>
    createEntryWithClient(admin, { actor: as(who), siteId, typeKey: "post", draft });
  const made = async (who: TestOwner, siteId = f.owner.pageId) => {
    const out = await post(who, undefined, siteId);
    if (!out.ok) throw new Error(`create: ${out.error}`);
    return out;
  };

  it("M19-06 the owner's writes are unchanged: create, publish, unpublish", async () => {
    const p = await made(f.owner);
    expect(await publishEntryWithClient(admin, { actor: as(f.owner), entryId: p.id, expectedRev: p.rev })).toMatchObject({ ok: true, rev: 2 });
    expect(await unpublishEntryWithClient(admin, { actor: as(f.owner), entryId: p.id, expectedRev: 2 })).toMatchObject({ ok: true });
  });

  it("M19-06 an editor creates and edits; every publish-class operation is forbidden", async () => {
    const p = await made(f.editor);
    const saved = await updateEntryWithClient(admin, { actor: as(f.editor), entryId: p.id, expectedRev: p.rev, draft: { title: "Edited", slug: "edited-e", body: "x" } });
    expect(saved).toMatchObject({ ok: true, rev: 2 });
    const forbidden = { ok: false, error: "forbidden", status: 403 };
    expect(await publishEntryWithClient(admin, { actor: as(f.editor), entryId: p.id, expectedRev: 2 })).toMatchObject(forbidden);
    // The owner publishes it; the editor can neither unpublish nor trash the live post.
    const live = await publishEntryWithClient(admin, { actor: as(f.owner), entryId: p.id, expectedRev: 2 });
    expect(live.ok).toBe(true);
    expect(await unpublishEntryWithClient(admin, { actor: as(f.editor), entryId: p.id, expectedRev: 3 })).toMatchObject(forbidden);
    expect(await trashEntryWithClient(admin, { actor: as(f.editor), entryId: p.id, expectedRev: 3 })).toMatchObject(forbidden);
    // A draft-only post the editor may trash and restore; purging is publish-class.
    const d = await made(f.editor);
    expect(await trashEntryWithClient(admin, { actor: as(f.editor), entryId: d.id, expectedRev: d.rev })).toMatchObject({ ok: true });
    expect(await purgeEntryWithClient(admin, { actor: as(f.editor), entryId: d.id })).toMatchObject(forbidden);
    expect(await restoreEntryWithClient(admin, { actor: as(f.editor), entryId: d.id, expectedRev: d.rev + 1 })).toMatchObject({ ok: true });
    // Scheduling is publish-class.
    expect(await scheduleEntryWithClient(admin, { actor: as(f.editor), entryId: d.id, expectedRev: d.rev + 2, action: "unpublish", runAt: "2099-01-01T00:00:00Z" })).toMatchObject(forbidden);
    // Terms: creating is an edit; renaming and deleting change the live site (publish).
    const term = await createTermWithClient(admin, { actor: as(f.editor), siteId: f.owner.pageId, typeKey: "post", taxonomy: "tag", name: "News", slug: "news-e" });
    expect(term.ok).toBe(true);
    const termId = term.ok ? term.id : "";
    expect(await renameTermWithClient(admin, { actor: as(f.editor), siteId: f.owner.pageId, termId, name: "Renamed" })).toMatchObject(forbidden);
    expect(await deleteTermWithClient(admin, { actor: as(f.editor), siteId: f.owner.pageId, termId })).toMatchObject(forbidden);
    // Type settings are owner-only (G14): the same not_found as a missing site.
    expect(await enableTypeWithClient(admin, { actor: as(f.editor), siteId: f.owner.pageId, typeKey: "post", enabled: false } as never)).toMatchObject({ ok: false, error: "not_found" });
    // Reads pass.
    expect(await listTypesWithClient(admin, { actor: as(f.editor), siteId: f.owner.pageId })).toMatchObject({ ok: true });
    expect(await listTermsWithClient(admin, { actor: as(f.editor), siteId: f.owner.pageId, typeKey: "post" })).toMatchObject({ ok: true });
  });

  it("M19-06 a publisher publishes, unpublishes, trashes a live post, purges and renames a term", async () => {
    const p = await made(f.publisher);
    expect(await publishEntryWithClient(admin, { actor: as(f.publisher), entryId: p.id, expectedRev: p.rev })).toMatchObject({ ok: true, rev: 2 });
    expect(await trashEntryWithClient(admin, { actor: as(f.publisher), entryId: p.id, expectedRev: 2 })).toMatchObject({ ok: true });
    const d = await made(f.publisher);
    await trashEntryWithClient(admin, { actor: as(f.publisher), entryId: d.id, expectedRev: d.rev });
    expect(await purgeEntryWithClient(admin, { actor: as(f.publisher), entryId: d.id })).toMatchObject({ ok: true });
    const term = await createTermWithClient(admin, { actor: as(f.publisher), siteId: f.owner.pageId, typeKey: "post", taxonomy: "tag", name: "P", slug: "news-p" });
    const termId = term.ok ? term.id : "";
    expect(await renameTermWithClient(admin, { actor: as(f.publisher), siteId: f.owner.pageId, termId, name: "Q" })).toMatchObject({ ok: true, name: "Q" });
    expect(await deleteTermWithClient(admin, { actor: as(f.publisher), siteId: f.owner.pageId, termId })).toMatchObject({ ok: true });
    // Still not the owner: type settings answer not_found.
    expect(await enableTypeWithClient(admin, { actor: as(f.publisher), siteId: f.owner.pageId, typeKey: "post", enabled: false } as never)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("M19-06 a stranger gets the same not_found as a missing id, for every operation", async () => {
    const p = await made(f.owner);
    const missingSite = await post(f.stranger, undefined, MISSING);
    expect(await post(f.stranger)).toEqual(missingSite);
    const missingEntry = await updateEntryWithClient(admin, { actor: as(f.stranger), entryId: MISSING, expectedRev: 1, draft: {} });
    expect(await updateEntryWithClient(admin, { actor: as(f.stranger), entryId: p.id, expectedRev: 1, draft: {} })).toEqual(missingEntry);
    expect(await publishEntryWithClient(admin, { actor: as(f.stranger), entryId: p.id, expectedRev: 1 })).toEqual(missingEntry);
    expect(await getEntryWithClient(admin, { actor: as(f.stranger), entryId: p.id })).toEqual(
      await getEntryWithClient(admin, { actor: as(f.stranger), entryId: MISSING }),
    );
    expect(missingEntry).toMatchObject({ ok: false, error: "not_found", status: 404 });
  });

  it("M19-06 an entry, sub-page or term of site B named under site A is not_found (T5)", async () => {
    // B is another owner's site; the publisher of A asks for B's ids under A.
    const bTerm = await createTermWithClient(admin, { actor: as(other), siteId: other.pageId, typeKey: "post", taxonomy: "tag", name: "B", slug: "b-tag" });
    const bTermId = bTerm.ok ? bTerm.id : "";
    expect(await renameTermWithClient(admin, { actor: as(f.publisher), siteId: f.owner.pageId, termId: bTermId, name: "X" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await deleteTermWithClient(admin, { actor: as(f.publisher), siteId: f.owner.pageId, termId: bTermId })).toMatchObject({ ok: false, error: "not_found" });
    const bPage = await createSubPageWithClient(admin as never, { userId: other.userId, siteId: other.pageId, title: "B page", path: "b-page" });
    expect(bPage.ok).toBe(true);
    const bPageId = bPage.ok ? bPage.id : "";
    expect(await deleteSubPageWithClient(admin as never, { userId: f.publisher.userId, siteId: f.owner.pageId, subPageId: bPageId })).toMatchObject({ ok: false, error: "not_found" });
    expect(await deleteSubPageWithClient(admin as never, { userId: f.owner.userId, siteId: f.owner.pageId, subPageId: bPageId })).toMatchObject({ ok: false, error: "not_found" });
    const still = await admin.from("content_entries").select("id").eq("id", bPageId);
    expect(still.data).toHaveLength(1);
  });

  it("M19-06 sub-pages: an editor adds a draft page and deletes it; a live page needs a publisher", async () => {
    const page = await createSubPageWithClient(admin as never, { userId: f.editor.userId, siteId: f.owner.pageId, title: "Editor page", path: "editor-page" });
    expect(page.ok).toBe(true);
    const id = page.ok ? page.id : "";
    expect(await deleteSubPageWithClient(admin as never, { userId: f.editor.userId, siteId: f.owner.pageId, subPageId: id })).toMatchObject({ ok: true });
    const live = await createSubPageWithClient(admin as never, { userId: f.owner.userId, siteId: f.owner.pageId, title: "Live", path: "live-page" });
    const liveId = live.ok ? live.id : "";
    const madeLive = await admin.from("content_entries").update({ published: { path: "live-page", title: "Live", description: "", blocks: [] } as never, published_at: new Date().toISOString() }).eq("id", liveId).select("id");
    expect(madeLive.error).toBeNull();
    expect(madeLive.data).toHaveLength(1);
    expect(await deleteSubPageWithClient(admin as never, { userId: f.editor.userId, siteId: f.owner.pageId, subPageId: liveId })).toMatchObject({ ok: false, error: "forbidden" });
    expect(await deleteSubPageWithClient(admin as never, { userId: f.publisher.userId, siteId: f.owner.pageId, subPageId: liveId })).toMatchObject({ ok: true });
    expect(await createSubPageWithClient(admin as never, { userId: f.stranger.userId, siteId: f.owner.pageId, title: "No" })).toMatchObject({ ok: false, error: "not_found" });
  });

  it("M19-06 a publisher's body image in the OWNER's folder publishes; the same file in their own folder is refused", async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const ownerPath = `${f.owner.userId}/m19c-body.webp`;
    const ownPath = `${f.publisher.userId}/m19c-body.webp`;
    for (const path of [ownerPath, ownPath]) {
      const up = await admin.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: true });
      expect(up.error, path).toBeNull();
    }
    const good = await post(f.publisher, { title: "Img", slug: "img-ok", body: `![a](${storageUrl(ownerPath)})` });
    const bad = await post(f.publisher, { title: "Img2", slug: "img-bad", body: `![a](${storageUrl(ownPath)})` });
    if (!good.ok || !bad.ok) throw new Error("create");
    expect(await publishEntryWithClient(admin, { actor: as(f.publisher), entryId: good.id, expectedRev: good.rev })).toMatchObject({ ok: true });
    const refused = await publishEntryWithClient(admin, { actor: as(f.publisher), entryId: bad.id, expectedRev: bad.rev });
    expect(refused).toMatchObject({ ok: false, error: "invalid" });
    expect(refused.ok ? [] : refused.issues?.map((i) => i.message)).toContain("That image isn’t in your uploads. Upload it again.");
    await admin.storage.from(MEDIA_BUCKET).remove([ownerPath, ownPath]);
  });

  it("M19-06 after removal the member's next write is not_found", async () => {
    const p = await made(f.editor);
    await admin.rpc("remove_site_member", { p_site: f.owner.pageId, p_actor: f.owner.userId, p_user: f.editor.userId });
    expect(await updateEntryWithClient(admin, { actor: as(f.editor), entryId: p.id, expectedRev: p.rev, draft: { title: "After" } })).toMatchObject({ ok: false, error: "not_found" });
    expect(await post(f.editor)).toMatchObject({ ok: false, error: "not_found" });
  });
});
