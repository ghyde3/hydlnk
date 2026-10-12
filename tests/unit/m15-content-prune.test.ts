// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient, updateEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient, unpublishEntryWithClient } from "@/lib/content/publish-core";
import { createTermWithClient, deleteTermWithClient } from "@/lib/content/terms-core";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { enablePost } from "./content-support";

vi.mock("server-only", () => ({}));

const { run } = await stackIsUp();
describe.skipIf(!run)("deleted terms and a disabled type", () => {
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
    a = await makeOwner(admin as never, "pr-a");
    b = await makeOwner(admin as never, "pr-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
    await enablePost(admin, b.pageId);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  const term = async (o: TestOwner, taxonomy: "category" | "tag", slug: string) => {
    const out = await createTermWithClient(admin, {
      actor: actor(o),
      siteId: o.pageId,
      typeKey: "post",
      taxonomy,
      name: slug,
      slug,
    });
    if (!out.ok) throw new Error(`term failed: ${out.error}`);
    return out.id;
  };
  const create = async (draft: unknown) => {
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

  it("a save and a publish drop a deleted term from the draft and the published copy", async () => {
    const cat = await term(a, "category", "gone");
    const tag = await term(a, "tag", "kept");
    const made = await create({
      title: "T",
      slug: "prune-me",
      terms: { categories: [cat], tags: [tag] },
    });
    expect(
      await deleteTermWithClient(admin, { actor: actor(a), siteId: a.pageId, termId: cat }),
    ).toMatchObject({ ok: true });
    const saved = await updateEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 1,
      draft: { title: "T2", slug: "prune-me", terms: { categories: [cat], tags: [tag] } },
    });
    expect(saved).toMatchObject({ ok: true, rev: 2 });
    expect((await row(made.id)).draft).toMatchObject({ terms: { categories: [], tags: [tag] } });
    const out = await publishEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 2,
    });
    expect(out).toMatchObject({ ok: true });
    expect((await row(made.id)).published).toMatchObject({
      terms: { categories: [], tags: [tag] },
    });
  });

  it("publish drops a deleted term even when the draft was not saved since", async () => {
    const cat = await term(a, "category", "gone-2");
    const made = await create({ title: "U", slug: "prune-pub", terms: { categories: [cat] } });
    await deleteTermWithClient(admin, { actor: actor(a), siteId: a.pageId, termId: cat });
    await publishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 1 });
    expect((await row(made.id)).published).toMatchObject({ terms: { categories: [] } });
  });

  it("another site's term and a tag listed as a category are dropped", async () => {
    const foreign = await term(b, "category", "theirs");
    const tag = await term(a, "tag", "just-a-tag");
    const made = await create({
      title: "V",
      slug: "prune-foreign",
      terms: { categories: [foreign, tag], tags: [] },
    });
    await publishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 1 });
    expect((await row(made.id)).published).toMatchObject({ terms: { categories: [], tags: [] } });
    const links = await admin.from("content_entry_terms").select("term_id").eq("entry_id", made.id);
    expect(links.data).toEqual([]);
  });

  it("unpublish works on a type switched off since; publish does not", async () => {
    const made = await create({ title: "W", slug: "off-type" });
    expect(
      await publishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 1 }),
    ).toMatchObject({ ok: true });
    await admin
      .from("content_types")
      .update({ enabled: false })
      .eq("site_id", a.pageId)
      .eq("key", "post");
    const off = await unpublishEntryWithClient(admin, {
      actor: actor(a),
      entryId: made.id,
      expectedRev: 2,
    });
    expect(off).toMatchObject({ ok: true, rev: 3 });
    expect((await row(made.id)).published).toBeNull();
    expect(
      await publishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 3 }),
    ).toMatchObject({ ok: false, error: "type_disabled" });
    await enablePost(admin, a.pageId);
  });
});
