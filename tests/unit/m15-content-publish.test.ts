// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient, updateEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient, unpublishEntryWithClient } from "@/lib/content/publish-core";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

const invalidatePage = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage }));
const adminMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => adminMock.current }));

const { run } = await stackIsUp();
describe.skipIf(!run)("publish and unpublish an entry", () => {
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
    a = await makeOwner(admin as never, "cp-a");
    b = await makeOwner(admin as never, "cp-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
  });
  beforeEach(() => invalidatePage.mockReset());
  afterAll(async () => removeOwners(admin as never, owners));

  const post = async (draft: unknown, o = a) => {
    const made = await createEntryWithClient(admin, {
      actor: actor(o),
      siteId: o.pageId,
      typeKey: "post",
      draft,
    });
    if (!made.ok) throw new Error(`create failed: ${made.error}`);
    return made;
  };
  const publish = (id: string, expectedRev: number, o = a) =>
    publishEntryWithClient(admin, { actor: actor(o), entryId: id, expectedRev });
  const row = async (id: string) =>
    (await admin.from("content_entries").select("*").eq("id", id).single()).data!;

  it("a post with no title is invalid and the database is unchanged", async () => {
    const made = await post({ slug: "no-title" });
    const out = await publish(made.id, 1);
    expect(out).toMatchObject({ ok: false, error: "invalid", status: 422 });
    expect(out.ok ? [] : out.issues).not.toHaveLength(0);
    expect(await row(made.id)).toMatchObject({ published: null, rev: 1 });
  });

  it("a valid publish stores the draft as published and bumps rev", async () => {
    const draft = { title: "Hello", slug: "hello", fields: { k: "kept" } };
    const made = await post(draft);
    const out = await publish(made.id, 1);
    expect(out).toMatchObject({ ok: true, rev: 2, siteId: a.pageId });
    const after = await row(made.id);
    expect(after.published).toEqual(draft);
    expect(after.published_at).not.toBeNull();
    expect(after.rev).toBe(2);
    expect(new Date(out.ok ? out.publishedAt : 0).getTime()).toBe(
      new Date(after.published_at!).getTime(),
    );
  });

  it("a second post with the same slug gives slug_taken", async () => {
    const made = await post({ title: "Again", slug: "hello" });
    expect(await publish(made.id, 1)).toMatchObject({
      ok: false,
      error: "slug_taken",
      status: 409,
    });
    expect((await row(made.id)).published).toBeNull();
  });

  it("a body link with an unsafe scheme is invalid with the offending text, never a 500", async () => {
    const made = await post({ title: "Bad", slug: "bad-link", body: "[x](javascript:alert(1))" });
    const out = await publish(made.id, 1);
    expect(out).toMatchObject({ ok: false, error: "invalid", status: 422 });
    expect(out.ok ? "" : out.issues?.[0]?.message).toContain("javascript:alert(1)");
    expect((await row(made.id)).published).toBeNull();
  });

  it("a stale expectedRev gives conflict with currentRev", async () => {
    const made = await post({ title: "Stale", slug: "stale" });
    expect(await publish(made.id, 5)).toMatchObject({
      ok: false,
      error: "conflict",
      status: 409,
      currentRev: 1,
    });
  });

  it("another user's entry gives not_found", async () => {
    const made = await post({ title: "Mine", slug: "mine" });
    expect(await publish(made.id, 1, b)).toMatchObject({ ok: false, error: "not_found" });
    expect(
      await unpublishEntryWithClient(admin, {
        actor: actor(b),
        entryId: made.id,
        expectedRev: 1,
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
  });

  it("a disabled type gives type_disabled", async () => {
    await enablePost(admin, b.pageId);
    const made = await post({ title: "Off", slug: "off" }, b);
    await admin
      .from("content_types")
      .update({ enabled: false })
      .eq("site_id", b.pageId)
      .eq("key", "post");
    expect(await publish(made.id, 1, b)).toMatchObject({ ok: false, error: "type_disabled" });
  });

  it("a post body linking to a blocked host gives blocked_link at publish", async () => {
    const made = await post({ title: "Bad", slug: "bad", body: "ok" });
    await admin
      .from("content_entries")
      .update({
        draft: { title: "Bad", slug: "bad", body: "[x](https://zq-pub-blocked.example/p)" },
      })
      .eq("id", made.id);
    await admin.from("blocked_domains").upsert({ domain: "zq-pub-blocked.example" } as never);
    const out = await publish(made.id, 1);
    await admin.from("blocked_domains").delete().eq("domain", "zq-pub-blocked.example");
    expect(out).toMatchObject({ ok: false, error: "blocked_link" });
  });

  it("a trashed entry gives not_found", async () => {
    const made = await post({ title: "Bin", slug: "bin" });
    await admin
      .from("content_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", made.id);
    expect(await publish(made.id, 1)).toMatchObject({ ok: false, error: "not_found" });
  });

  it("unpublish clears published, bumps rev, and a stale rev conflicts", async () => {
    const made = await post({ title: "Down", slug: "down" });
    const up = await publish(made.id, 1);
    if (!up.ok) throw new Error("publish failed");
    const stale = await unpublishEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
    });
    expect(stale).toMatchObject({ ok: false, error: "conflict", currentRev: 2 });
    const out = await unpublishEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 2,
    });
    expect(out).toMatchObject({ ok: true, rev: 3, siteId: a.pageId });
    expect(await row(made.id)).toMatchObject({ published: null, published_at: null, rev: 3 });
  });

  it("a concurrent publish and update: exactly one wins and the row is consistent", async () => {
    const made = await post({ title: "Race", slug: "race" });
    const [pub, upd] = await Promise.all([
      publish(made.id, 1),
      updateEntryWithClient(admin, {
        actor: actor(a),
        entryId: made.id,
        expectedRev: 1,
        draft: { title: "Race edited", slug: "race" },
      }),
    ]);
    expect([pub.ok, upd.ok].filter(Boolean)).toHaveLength(1);
    const loser = pub.ok ? upd : pub;
    expect(loser).toMatchObject({ ok: false, error: "conflict", currentRev: 2 });
    const after = await row(made.id);
    expect(after.rev).toBe(2);
    if (pub.ok) {
      expect(after.published).toEqual({ title: "Race", slug: "race" });
      expect(after.draft).toEqual({ title: "Race", slug: "race" });
    } else {
      expect(after.published).toBeNull();
    }
  });

  describe("the wrapper", () => {
    it("expires the site tag once after ok publish and unpublish, never after a refusal, and swallows a throw", async () => {
      const { publishEntry, unpublishEntry } = await import("@/lib/content");
      const made = await post({ title: "Wrap", slug: "wrap" });
      expect(
        await publishEntry({ actor: actor(b), entryId: made.id, expectedRev: 1 }),
      ).toMatchObject({ ok: false });
      expect(invalidatePage).not.toHaveBeenCalled();
      invalidatePage.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      const out = await publishEntry({ actor: actor(a), entryId: made.id, expectedRev: 1 });
      expect(out).toMatchObject({ ok: true });
      expect(invalidatePage).toHaveBeenCalledTimes(1);
      expect(invalidatePage).toHaveBeenCalledWith(a.pageId);
      const down = await unpublishEntry({ actor: actor(a), entryId: made.id, expectedRev: 2 });
      expect(down).toMatchObject({ ok: true });
      expect(invalidatePage).toHaveBeenCalledTimes(2);
    });
  });
});
