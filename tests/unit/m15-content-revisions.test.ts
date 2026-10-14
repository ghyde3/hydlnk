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
