// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { contentTypes } from "./content-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const { run } = await stackIsUp();
const { createEntryWithClient, updateEntryWithClient } = await import("@/lib/content/entries-core");
const { publishEntryWithClient, unpublishEntryWithClient } =
  await import("@/lib/content/publish-core");
const { countEntriesWithClient, getEntryWithClient, listEntriesWithClient } =
  await import("@/lib/content/query-core");
const { restoreEntryWithClient, trashEntryWithClient } = await import("@/lib/content/trash-core");
const { enableTypeWithClient, listTypesWithClient, updateTypeWithClient } =
  await import("@/lib/content/types-core");

/**
 * M16-02 (unit), M16-12: the reads the Posts screen starts from (the site's types, how many posts it
 * holds, which posts have unpublished changes) and what the writes hand to the cache expiry.
 */
describe.skipIf(!run)("M16-02 types, counts and entry status (local Supabase)", () => {
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
  const types = (o: TestOwner, siteId = o.pageId) =>
    listTypesWithClient(admin, { actor: actor(o), siteId });
  const count = (o: TestOwner, over: { siteId?: string; typeKey?: string } = {}) =>
    countEntriesWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey: "post", ...over });
  const enable = (o: TestOwner, enabled: boolean, siteId = o.pageId) =>
    enableTypeWithClient(admin, { actor: actor(o), siteId, typeKey: "post", enabled });
  const post = async (draft: Record<string, unknown>) => {
    const made = await createEntryWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "post",
      draft,
    });
    if (!made.ok) throw new Error(`create failed: ${made.error} ${made.message}`);
    return made;
  };
  const summary = async (id: string) => {
    const out = await listEntriesWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "post",
      sort: "updated_at",
      limit: 100,
    });
    if (!out.ok) throw new Error(out.message);
    return out.items.find((item) => item.id === id);
  };

  beforeAll(async () => {
    a = await makeOwner(admin as never, "ty-a");
    b = await makeOwner(admin as never, "ty-b");
    owners.push(a, b);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  it("lists the site's built-in types, the page type first, the blog off until it is added", async () => {
    const { page, post: postType } = await contentTypes(admin, a.pageId);
    expect(await types(a)).toEqual({
      ok: true,
      types: [
        {
          typeId: page.id,
          key: "page",
          label: page.label,
          labelPlural: page.label_plural,
          enabled: true,
          archivePath: null,
        },
        {
          typeId: postType.id,
          key: "post",
          label: postType.label,
          labelPlural: postType.label_plural,
          enabled: false,
          archivePath: "blog",
        },
      ],
    });
  });

  it("another user's site and a malformed id are the same not_found, for every type call", async () => {
    const other = await types(b, a.pageId);
    expect(other).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await types(a, "not-a-uuid")).toEqual(other);
    expect(await types(a, "00000000-0000-4000-8000-000000000000")).toEqual(other);
    expect(await count(b, { siteId: a.pageId })).toEqual(other);
    expect(await enable(b, true, a.pageId)).toEqual(other);
    expect(
      await updateTypeWithClient(admin, {
        actor: actor(b),
        siteId: a.pageId,
        typeKey: "post",
        archivePath: "taken-over",
      }),
    ).toEqual(other);
    const { post: postType } = await contentTypes(admin, a.pageId);
    expect(postType).toMatchObject({ enabled: false, archive_path: "blog" });
  });

  it("a suspended account cannot turn the blog on or move it, and can still read its types", async () => {
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", b.userId);
    expect(await enable(b, true)).toMatchObject({
      ok: false,
      error: "account_suspended",
      status: 403,
    });
    expect(
      await updateTypeWithClient(admin, {
        actor: actor(b),
        siteId: b.pageId,
        typeKey: "post",
        archivePath: "journal",
      }),
    ).toMatchObject({ ok: false, error: "account_suspended" });
    expect(await types(b)).toMatchObject({ ok: true });
    expect(await count(b)).toEqual({ ok: true, count: 0 });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", b.userId);
    const { post: postType } = await contentTypes(admin, b.pageId);
    expect(postType).toMatchObject({ enabled: false, archive_path: "blog" });
  });

  it("turning the blog on shows in the list; a new archive path too", async () => {
    expect(await enable(a, true)).toMatchObject({ ok: true, enabled: true, archivePath: "blog" });
    expect(
      await updateTypeWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        typeKey: "post",
        archivePath: "journal",
      }),
    ).toMatchObject({ ok: true, archivePath: "journal" });
    const out = await types(a);
    expect(out.ok && out.types[1]).toMatchObject({
      key: "post",
      enabled: true,
      archivePath: "journal",
    });
  });

  it("counts posts as HL010 does: drafts, live posts and the trash, and not pages", async () => {
    expect(await count(a)).toEqual({ ok: true, count: 0 });
    const one = await post({ title: "One", slug: "zq-ty-one" });
    await post({ title: "Two" });
    const three = await post({ title: "Three" });
    await createEntryWithClient(admin, {
      actor: actor(a),
      siteId: a.pageId,
      typeKey: "page",
      draft: { path: "zq-ty-page", title: "P", description: "", blocks: [] },
    });
    expect(
      await publishEntryWithClient(admin, { actor: actor(a), entryId: one.id, expectedRev: 1 }),
    ).toMatchObject({ ok: true });
    expect(
      await trashEntryWithClient(admin, { actor: actor(a), entryId: three.id, expectedRev: 1 }),
    ).toMatchObject({ ok: true });
    expect(await count(a)).toEqual({ ok: true, count: 3 });
    expect(await count(a, { typeKey: "nope" })).toMatchObject({ ok: false, error: "not_found" });
    const pages = await count(a, { typeKey: "page" });
    expect(pages.ok && pages.count).toBeGreaterThanOrEqual(1);
  });

  it("publish, unpublish, trash and restore answer with the entry's site, type id and type key", async () => {
    const { post: postType } = await contentTypes(admin, a.pageId);
    const where = { siteId: a.pageId, typeId: postType.id, typeKey: "post" };
    const made = await post({ title: "Where", slug: "zq-ty-where" });
    const input = (expectedRev: number) => ({ actor: actor(a), entryId: made.id, expectedRev });
    expect(await publishEntryWithClient(admin, input(1))).toMatchObject({
      ok: true,
      rev: 2,
      ...where,
    });
    expect(await unpublishEntryWithClient(admin, input(2))).toEqual({ ok: true, rev: 3, ...where });
    expect(await trashEntryWithClient(admin, input(3))).toEqual({ ok: true, rev: 4, ...where });
    expect(await restoreEntryWithClient(admin, input(4))).toEqual({ ok: true, rev: 5, ...where });
  });

  it("taking a post down still names its type after the blog was turned off", async () => {
    const { post: postType } = await contentTypes(admin, a.pageId);
    const made = await post({ title: "Down", slug: "zq-ty-down" });
    const input = (expectedRev: number) => ({ actor: actor(a), entryId: made.id, expectedRev });
    expect(await publishEntryWithClient(admin, input(1))).toMatchObject({ ok: true });
    expect(await enable(a, false)).toMatchObject({ ok: true, enabled: false });
    expect(await publishEntryWithClient(admin, input(2))).toMatchObject({
      ok: false,
      error: "type_disabled",
    });
    expect(await unpublishEntryWithClient(admin, input(2))).toEqual({
      ok: true,
      rev: 3,
      siteId: a.pageId,
      typeId: postType.id,
      typeKey: "post",
    });
    expect(await enable(a, true)).toMatchObject({ ok: true });
  });

  it("hasUnpublishedChanges: false for a draft and a fresh publish, true after an edit, false again when the edit is undone", async () => {
    const draft = { title: "Status", slug: "zq-ty-status", body: "First." };
    const made = await post(draft);
    expect(await summary(made.id)).toMatchObject({ status: "draft", hasUnpublishedChanges: false });

    expect(
      await publishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 1 }),
    ).toMatchObject({ ok: true });
    expect(await summary(made.id)).toMatchObject({
      status: "published",
      hasUnpublishedChanges: false,
    });
    const got = await getEntryWithClient(admin, { actor: actor(a), entryId: made.id });
    expect(got).toMatchObject({ ok: true, typeKey: "post", hasUnpublishedChanges: false });

    const edit = (expectedRev: number, body: string) =>
      updateEntryWithClient(admin, {
        actor: actor(a),
        entryId: made.id,
        expectedRev,
        draft: { ...draft, body },
      });
    expect(await edit(2, "Second.")).toMatchObject({ ok: true, rev: 3 });
    expect(await summary(made.id)).toMatchObject({
      status: "published",
      hasUnpublishedChanges: true,
    });
    expect(await getEntryWithClient(admin, { actor: actor(a), entryId: made.id })).toMatchObject({
      hasUnpublishedChanges: true,
    });

    // The same content again (key order aside) is not a change, whatever the rev says.
    expect(await edit(3, "First.")).toMatchObject({ ok: true, rev: 4 });
    expect(await summary(made.id)).toMatchObject({
      status: "published",
      hasUnpublishedChanges: false,
    });

    expect(await edit(4, "Third.")).toMatchObject({ ok: true, rev: 5 });
    expect(
      await publishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 5 }),
    ).toMatchObject({ ok: true, rev: 6 });
    expect(await summary(made.id)).toMatchObject({ hasUnpublishedChanges: false });

    // Unpublished and trashed posts have no live copy to differ from.
    expect(
      await unpublishEntryWithClient(admin, { actor: actor(a), entryId: made.id, expectedRev: 6 }),
    ).toMatchObject({ ok: true });
    expect(await summary(made.id)).toMatchObject({ status: "draft", hasUnpublishedChanges: false });
  });
});
