// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { createEntryWithClient } from "@/lib/content/entries-core";
import { publishEntryWithClient } from "@/lib/content/publish-core";
import {
  createTermWithClient,
  deleteTermWithClient,
  renameTermWithClient,
  setEntryTermsWithClient,
} from "@/lib/content/terms-core";
import { enableTypeWithClient, updateTypeWithClient } from "@/lib/content/types-core";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));

const { run } = await stackIsUp();
describe.skipIf(!run)("content types and terms", () => {
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
    a = await makeOwner(admin as never, "ct-a");
    b = await makeOwner(admin as never, "ct-b");
    owners.push(a, b);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  const enable = (o: TestOwner, enabled = true, typeKey = "post") =>
    enableTypeWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey, enabled });
  const term = (o: TestOwner, over: Partial<Parameters<typeof createTermWithClient>[1]> = {}) =>
    createTermWithClient(admin, {
      actor: actor(o),
      siteId: o.pageId,
      typeKey: "post",
      taxonomy: "category",
      name: "News",
      slug: "news",
      ...over,
    });
  const idOf = (out: { ok: true; id: string } | { ok: false; error: string }) => {
    if (!out.ok) throw new Error(`failed: ${out.error}`);
    return out.id;
  };

  it("a term on a type that is off gives type_disabled", async () => {
    expect(await term(a)).toMatchObject({ ok: false, error: "type_disabled" });
  });

  it("enabling post registers the blog path, and a page at blog is then path_taken", async () => {
    expect(await enable(a)).toMatchObject({ ok: true, enabled: true, key: "post" });
    const claimed = await admin
      .from("site_paths")
      .select("path")
      .eq("site_id", a.pageId)
      .eq("path", "blog");
    expect(claimed.data).toHaveLength(1);
    const page = await createEntryWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "page",
      draft: { path: "blog", title: "T", description: "", blocks: [] },
    });
    expect(page).toMatchObject({ ok: false, error: "path_taken" });
  });

  it("the page type cannot be turned off, and an unknown type is not_found", async () => {
    expect(await enable(a, false, "page")).toMatchObject({ ok: false, error: "invalid" });
    expect(await enable(a, true, "nope")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("another user's site gives not_found", async () => {
    expect(
      await enableTypeWithClient(admin, {
        actor: actor(b),
        siteId: a.pageId,
        typeKey: "post",
        enabled: false,
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
    expect(await term(b, { siteId: a.pageId })).toMatchObject({ ok: false, error: "not_found" });
  });

  it("updateType renames labels and moves the archive path; a taken path is path_taken", async () => {
    const out = await updateTypeWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "post",
      label: "Article",
      labelPlural: "Articles",
      archivePath: "journal",
    });
    expect(out).toMatchObject({ ok: true, label: "Article", archivePath: "journal" });
    const paths = await admin.from("site_paths").select("path").eq("site_id", a.pageId);
    expect(paths.data?.map((p) => p.path)).toContain("journal");
    expect(paths.data?.map((p) => p.path)).not.toContain("blog");
    const clash = await createEntryWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "page",
      draft: { path: "taken-by-page", title: "T", description: "", blocks: [] },
    });
    expect(clash.ok).toBe(true);
    expect(
      await updateTypeWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        typeKey: "post",
        archivePath: "taken-by-page",
      }),
    ).toMatchObject({ ok: false, error: "path_taken" });
    expect(
      await updateTypeWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        typeKey: "post",
        archivePath: "Bad Path!",
      }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await updateTypeWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        typeKey: "post",
        label: "",
      }),
    ).toMatchObject({ ok: false, error: "invalid" });
  });

  let parent: string;
  let child: string;
  it("a category with a child works; a grandchild is invalid", async () => {
    parent = idOf(await term(a));
    child = idOf(await term(a, { name: "Local", slug: "local", parentId: parent }));
    const row = await admin.from("content_terms").select("parent_id").eq("id", child).single();
    expect(row.data?.parent_id).toBe(parent);
    expect(await term(a, { name: "Deep", slug: "deep", parentId: child })).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });

  it("a tag with a parent is invalid; a parent of another taxonomy is invalid", async () => {
    expect(
      await term(a, { taxonomy: "tag", name: "T", slug: "t", parentId: parent }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(await term(a, { name: "X", slug: "x", parentId: crypto.randomUUID() })).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });

  it("a duplicate slug is slug_taken, and a bad slug or name is invalid", async () => {
    expect(await term(a)).toMatchObject({ ok: false, error: "slug_taken" });
    expect(await term(a, { slug: "Not OK" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await term(a, { name: "   ", slug: "blank" })).toMatchObject({
      ok: false,
      error: "invalid",
    });
  });

  it("rename changes name and slug; a clashing slug is slug_taken", async () => {
    const tag = idOf(await term(a, { taxonomy: "tag", name: "Ideas", slug: "ideas" }));
    expect(
      await renameTermWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        termId: tag,
        name: "Notions",
        slug: "notions",
      }),
    ).toMatchObject({ ok: true, name: "Notions", slug: "notions" });
    expect(
      await renameTermWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        termId: child,
        slug: "news",
      }),
    ).toMatchObject({ ok: false, error: "slug_taken" });
    expect(
      await renameTermWithClient(admin, {
        actor: actor(b),
        siteId: b.pageId,
        termId: tag,
        name: "Hijack",
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
  });

  describe("an entry's terms", () => {
    let entryId: string;
    let tagId: string;
    let foreign: string;
    const setTerms = (rev: number, categories: string[], tags: string[]) =>
      setEntryTermsWithClient(admin, {
        actor: actor(a),
        entryId,
        expectedRev: rev,
        categories,
        tags,
      });

    beforeAll(async () => {
      tagId = idOf(await term(a, { taxonomy: "tag", name: "Tagged", slug: "tagged" }));
      await enable(b);
      foreign = idOf(await term(b, { name: "Theirs", slug: "theirs" }));
      const made = await createEntryWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        typeKey: "post",
        draft: { title: "Hello", slug: "hello", body: "Hi" },
      });
      entryId = idOf(made);
    });

    it("a stale rev gives conflict with currentRev", async () => {
      expect(await setTerms(9, [parent], [])).toMatchObject({
        ok: false,
        error: "conflict",
        currentRev: 1,
      });
    });

    it("another site's term, or a tag id sent as a category, is invalid", async () => {
      expect(await setTerms(1, [foreign], [])).toMatchObject({ ok: false, error: "invalid" });
      expect(await setTerms(1, [tagId], [])).toMatchObject({ ok: false, error: "invalid" });
      expect(await setTerms(1, [crypto.randomUUID()], [])).toMatchObject({
        ok: false,
        error: "invalid",
      });
    });

    it("writes only the draft; publish then rebuilds content_entry_terms exactly", async () => {
      const set = await setTerms(1, [parent, child], [tagId]);
      expect(set).toMatchObject({ ok: true, rev: 2 });
      const draft = await admin.from("content_entries").select("draft").eq("id", entryId).single();
      expect((draft.data!.draft as { terms: unknown }).terms).toEqual({
        categories: [parent, child],
        tags: [tagId],
      });
      const before = await admin
        .from("content_entry_terms")
        .select("term_id")
        .eq("entry_id", entryId);
      expect(before.data).toHaveLength(0);
      const pub = await publishEntryWithClient(admin, {
        actor: actor(a),
        entryId,
        expectedRev: 2,
      });
      expect(pub.ok).toBe(true);
      const links = await admin
        .from("content_entry_terms")
        .select("term_id")
        .eq("entry_id", entryId);
      expect(links.data?.map((l) => l.term_id).sort()).toEqual([parent, child, tagId].sort());
    });

    it("deleting a term removes its links and re-parents its children", async () => {
      expect(
        await deleteTermWithClient(admin, { actor: actor(a), siteId: a.pageId, termId: parent }),
      ).toMatchObject({ ok: true });
      const links = await admin
        .from("content_entry_terms")
        .select("term_id")
        .eq("entry_id", entryId);
      expect(links.data?.map((l) => l.term_id).sort()).toEqual([child, tagId].sort());
      const kid = await admin.from("content_terms").select("parent_id").eq("id", child).single();
      expect(kid.data?.parent_id).toBeNull();
      expect(
        await deleteTermWithClient(admin, { actor: actor(a), siteId: a.pageId, termId: parent }),
      ).toMatchObject({ ok: false, error: "not_found" });
      expect(
        await deleteTermWithClient(admin, { actor: actor(b), siteId: b.pageId, termId: tagId }),
      ).toMatchObject({ ok: false, error: "not_found" });
    });
  });

  it("a suspended account cannot change types or terms", async () => {
    const c = await makeOwner(admin as never, "ct-c");
    owners.push(c);
    await enable(c);
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", c.userId);
    expect(await enable(c, false)).toMatchObject({ ok: false, error: "account_suspended" });
    expect(await term(c)).toMatchObject({ ok: false, error: "account_suspended" });
  });
});
