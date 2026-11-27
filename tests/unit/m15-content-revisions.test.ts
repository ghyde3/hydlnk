// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient, updateEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient } from "@/lib/content/publish-core";
import { listRevisionsWithClient, restoreRevisionWithClient } from "@/lib/content/revisions-core";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

vi.mock("server-only", () => ({}));

const { run } = await stackIsUp();
describe.skipIf(!run)("entry revisions", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  let a: TestOwner;
  let b: TestOwner;
  const actor = (o: TestOwner) => ({ userId: o.userId, source: "editor" as const });

  beforeAll(async () => {
    a = await makeOwner(admin as never, "rv-a");
    b = await makeOwner(admin as never, "rv-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  const make = async (draft: unknown) => {
    const made = await createEntryWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "post",
      draft,
    });
    if (!made.ok) throw new Error(`create failed: ${made.error}`);
    return made;
  };
  const row = async (id: string) =>
    (await admin.from("content_entries").select("*").eq("id", id).single()).data!;

  it("12 publishes on Free leave exactly 10 revisions, the newest ones", async () => {
    const made = await make({ title: "Many", slug: "many" });
    let rev = made.rev;
    for (let i = 0; i < 12; i++) {
      const out = await publishEntryWithClient(admin, {
        actor: actor(a),
        entryId: made.id,
        expectedRev: rev,
      });
      if (!out.ok) throw new Error(`publish failed: ${out.error}`);
      rev = out.rev;
    }
    const listed = await listRevisionsWithClient(admin, { actor: actor(a), entryId: made.id });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.revisions).toHaveLength(10);
    expect(listed.revisions.map((r) => r.rev)).toEqual(
      Array.from({ length: 10 }, (_, i) => rev - i),
    );
    expect(listed.revisions.every((r) => r.wasPublished && r.source === "editor")).toBe(true);
    expect(listed.revisions[0]!).not.toHaveProperty("snapshot");
    expect(typeof listed.revisions[0]!.createdAt).toBe("string");
  });

  it("restoring a revision sets the draft, bumps rev, and leaves published alone", async () => {
    const first = { title: "One", slug: "one" };
    const made = await make(first);
    const pub = await publishEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
    });
    if (!pub.ok) throw new Error("publish");
    const upd = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: pub.rev,
      draft: { title: "Two", slug: "one" },
    });
    expect(upd).toMatchObject({ ok: true, rev: 3 });
    const before = await row(made.id);

    const out = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: pub.rev,
      expectedRev: 3,
    });
    expect(out).toMatchObject({ ok: true, rev: 4 });
    const after = await row(made.id);
    expect(after.draft).toEqual(first);
    expect(after.rev).toBe(4);
    expect(after.published).toEqual(before.published);
    expect(after.published_at).toEqual(before.published_at);
  });

  const snapshots = async (id: string) => {
    const { data, error } = await admin
      .from("content_entry_revisions")
      .select("rev, snapshot")
      .eq("entry_id", id)
      .order("rev");
    if (error) throw new Error(error.message);
    return data.map((r) => ({ rev: Number(r.rev), snapshot: r.snapshot }));
  };

  it("M15-10 restoring keeps the draft it replaces, also one saved too recently for a revision of its own", async () => {
    const x = { title: "X", slug: "keep" };
    const z = { title: "Z", slug: "keep" };
    const made = await make({ title: "W", slug: "keep" });
    // Save X: the first revision. Save Z moments later: none, by the 10-minute rule.
    const savedX = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: x,
    });
    expect(savedX).toMatchObject({ ok: true, rev: 2 });
    const savedZ = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 2,
      draft: z,
    });
    expect(savedZ).toMatchObject({ ok: true, rev: 3 });
    expect(await snapshots(made.id)).toEqual([{ rev: 2, snapshot: x }]);

    const out = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: 2,
      expectedRev: 3,
    });
    expect(out).toMatchObject({ ok: true, rev: 4, unchanged: false });
    expect((await row(made.id)).draft).toEqual(x);
    // Z is a revision now, so it can be brought back.
    expect(await snapshots(made.id)).toEqual([
      { rev: 2, snapshot: x },
      { rev: 3, snapshot: z },
    ]);
    const back = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: 3,
      expectedRev: 4,
    });
    expect(back).toMatchObject({ ok: true, rev: 5 });
    expect((await row(made.id)).draft).toEqual(z);
  });

  it("M15-10 a restore refused for a stale rev records nothing", async () => {
    const made = await make({ title: "W", slug: "norec" });
    await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "X", slug: "norec" },
    });
    await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 2,
      draft: { title: "Z", slug: "norec" },
    });
    const out = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: 2,
      expectedRev: 2,
    });
    expect(out).toMatchObject({ ok: false, error: "conflict", currentRev: 3 });
    expect((await snapshots(made.id)).map((r) => r.rev)).toEqual([2]);
    expect((await row(made.id)).draft).toEqual({ title: "Z", slug: "norec" });
  });

  it("M15-10 restoring the oldest kept revision on Free: the draft is kept, the plan's 10 are not passed", async () => {
    const made = await make({ title: "Zero", slug: "full" });
    let rev = made.rev;
    // Ten revisions (every publish records one): the plan's limit on Free.
    for (let i = 0; i < 10; i++) {
      const out = await publishEntryWithClient(admin, {
        actor: actor(a),
        entryId: made.id,
        expectedRev: rev,
      });
      if (!out.ok) throw new Error(`publish failed: ${out.error}`);
      rev = out.rev;
    }
    const oldest = (await snapshots(made.id))[0]!;
    expect(await snapshots(made.id)).toHaveLength(10);
    const z = { title: "Newest", slug: "full" };
    const saved = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: rev,
      draft: z,
    });
    expect(saved).toMatchObject({ ok: true, rev: rev + 1 });

    // Recording Z prunes the oldest revision, the one being restored: its snapshot is still applied.
    const out = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: oldest.rev,
      expectedRev: rev + 1,
    });
    expect(out).toMatchObject({ ok: true, rev: rev + 2 });
    expect((await row(made.id)).draft).toEqual(oldest.snapshot);
    const kept = await snapshots(made.id);
    expect(kept).toHaveLength(10);
    expect(kept.at(-1)).toEqual({ rev: rev + 1, snapshot: z });
  });

  it("M15-10 a draft that differs from the revision at its own rev (a page the move rewrote) is kept too", async () => {
    const original = { title: "Original", slug: "moved" };
    const rewritten = { title: "Rewritten", slug: "moved" };
    const made = await make(rewritten);
    // As the content move leaves it: a system revision at rev 1 holding the draft before the rewrite.
    const seeded = await admin.from("content_entry_revisions").insert({
      entry_id: made.id,
      site_id: a.pageId,
      rev: 1,
      snapshot: original,
      source: "system",
    });
    expect(seeded.error).toBeNull();

    const out = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: 1,
      expectedRev: 1,
    });
    expect(out).toMatchObject({ ok: true, unchanged: false });
    expect((await row(made.id)).draft).toEqual(original);
    const kept = await snapshots(made.id);
    expect(kept.map((r) => r.snapshot)).toContainEqual(rewritten);
    if (out.ok) expect((await row(made.id)).rev).toBe(out.rev);
  });

  it("a stale expectedRev gives conflict with currentRev", async () => {
    const made = await make({ title: "Stale", slug: "stale" });
    const upd = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "Stale 2", slug: "stale" },
    });
    expect(upd).toMatchObject({ ok: true, rev: 2 });
    const out = await restoreRevisionWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      rev: 2,
      expectedRev: 1,
    });
    expect(out).toMatchObject({ ok: false, error: "conflict", currentRev: 2 });
  });

  it("another user's entry and an unknown rev give not_found", async () => {
    const made = await make({ title: "Mine", slug: "mine" });
    expect(
      await listRevisionsWithClient(admin, { actor: actor(b), entryId: made.id }),
    ).toMatchObject({ ok: false, error: "not_found" });
    expect(
      await restoreRevisionWithClient(admin, {
        actor: actor(b),
        entryId: made.id,
        rev: 1,
        expectedRev: 1,
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
    expect(
      await restoreRevisionWithClient(admin, {
        actor: actor(a),
        entryId: made.id,
        rev: 77,
        expectedRev: 1,
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
  });
});
