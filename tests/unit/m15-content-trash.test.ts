// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient, updateEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient } from "@/lib/content/publish-core";
import { restoreEntryWithClient, trashEntryWithClient } from "@/lib/content/trash-core";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

const invalidatePage = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage }));
const adminMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => adminMock.current }));

const { run } = await stackIsUp();
describe.skipIf(!run)("trash and restore an entry", () => {
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const owners: TestOwner[] = [];
  let a: TestOwner;
  let b: TestOwner;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });

  beforeAll(async () => {
    adminMock.current = admin;
    a = await makeOwner(admin as never, "ct-a");
    b = await makeOwner(admin as never, "ct-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
  });
  beforeEach(() => invalidatePage.mockReset());
  afterAll(async () => removeOwners(admin as never, owners));

  const make = async (typeKey: string, draft: unknown, o = a) => {
    const made = await createEntryWithClient(admin, {
      actor: actor(o),
      siteId: o.pageId,
      typeKey,
      draft,
    });
    if (!made.ok) throw new Error(`create failed: ${made.error}`);
    return made;
  };
  const trash = (id: string, expectedRev: number, o = a) =>
    trashEntryWithClient(admin, { actor: actor(o), entryId: id, expectedRev });
  const restore = (id: string, expectedRev: number, o = a) =>
    restoreEntryWithClient(admin, { actor: actor(o), entryId: id, expectedRev });
  const row = async (id: string) =>
    (await admin.from("content_entries").select("*").eq("id", id).single()).data!;
  const page = (path: string) => ({ path, title: "T", description: "", blocks: [] });

  it("trashing a published post clears published at once and keeps the draft", async () => {
    const draft = { title: "Gone", slug: "gone" };
    const made = await make("post", draft);
    const pub = await publishEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
    });
    expect(pub).toMatchObject({ ok: true, rev: 2 });
    const out = await trash(made.id, 2);
    expect(out).toMatchObject({ ok: true, rev: 3, siteId: a.pageId });
    expect(await row(made.id)).toMatchObject({
      published: null,
      published_at: null,
      draft,
      rev: 3,
    });
    expect((await row(made.id)).deleted_at).not.toBeNull();
  });

  it("updateEntry on a trashed entry gives not_found", async () => {
    const made = await make("post", { title: "T1", slug: "t1" });
    await trash(made.id, 1);
    expect(
      await updateEntryWithClient(admin, {
        actor: actor(a),
        entryId: made.id,
        expectedRev: 2,
        draft: { title: "T1b", slug: "t1" },
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
  });

  it("trashing a trashed entry gives not_found", async () => {
    const made = await make("post", { title: "Twice", slug: "twice" });
    await trash(made.id, 1);
    expect(await trash(made.id, 2)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("restore within 30 days works and the entry is a draft again", async () => {
    const draft = { title: "Back", slug: "back" };
    const made = await make("post", draft);
    await trash(made.id, 1);
    const out = await restore(made.id, 2);
    expect(out).toMatchObject({ ok: true, rev: 3, siteId: a.pageId });
    expect(await row(made.id)).toMatchObject({
      deleted_at: null,
      published: null,
      draft,
      rev: 3,
    });
  });

  it("restore of an entry that is not trashed gives not_found", async () => {
    const made = await make("post", { title: "Live", slug: "live" });
    expect(await restore(made.id, 1)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("restore after 31 days gives not_found", async () => {
    const made = await make("post", { title: "Old", slug: "old" });
    await trash(made.id, 1);
    const old = new Date(Date.now() - 31 * 86400_000).toISOString();
    await admin.from("content_entries").update({ deleted_at: old }).eq("id", made.id);
    expect(await restore(made.id, 2)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("a stale rev gives conflict with currentRev, on both", async () => {
    const made = await make("post", { title: "Stale", slug: "stale" });
    expect(await trash(made.id, 9)).toMatchObject({
      ok: false,
      error: "conflict",
      status: 409,
      currentRev: 1,
    });
    await trash(made.id, 1);
    expect(await restore(made.id, 9)).toMatchObject({
      ok: false,
      error: "conflict",
      currentRev: 2,
    });
    expect((await row(made.id)).rev).toBe(2);
  });

  it("another user's entry gives not_found and changes nothing", async () => {
    const made = await make("post", { title: "Mine", slug: "mine" });
    expect(await trash(made.id, 1, b)).toMatchObject({ ok: false, error: "not_found" });
    await trash(made.id, 1);
    expect(await restore(made.id, 2, b)).toMatchObject({ ok: false, error: "not_found" });
    expect((await row(made.id)).deleted_at).not.toBeNull();
  });

  it("a suspended account can't trash or restore", async () => {
    const made = await make("post", { title: "Susp", slug: "susp" });
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", a.userId);
    expect(await trash(made.id, 1)).toMatchObject({ ok: false, error: "account_suspended" });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", a.userId);
    expect((await row(made.id)).deleted_at).toBeNull();
  });

  it("restoring a page whose path was taken meanwhile gives path_taken", async () => {
    const first = await make("page", page("/zt-clash"));
    await trash(first.id, 1);
    await make("page", page("/zt-clash"));
    expect(await restore(first.id, 2)).toMatchObject({
      ok: false,
      error: "path_taken",
      status: 409,
    });
    expect((await row(first.id)).deleted_at).not.toBeNull();
  });

  it("purge_trashed_entries is not callable with the admin client (the job runs it)", async () => {
    const made = await make("post", { title: "Purge", slug: "purge" });
    await trash(made.id, 1);
    const old = new Date(Date.now() - 31 * 86400_000).toISOString();
    await admin.from("content_entries").update({ deleted_at: old }).eq("id", made.id);
    const out = await admin.rpc("purge_trashed_entries");
    expect(out.error).not.toBeNull();
    expect((await row(made.id)).id).toBe(made.id);
  });
});
