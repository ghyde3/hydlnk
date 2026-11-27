// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { CONTENT_MESSAGES, CONTENT_STATUS, mapDbError } from "@/lib/content/errors";
import {
  createTermWithClient,
  deleteTermWithClient,
  listTermsWithClient,
  renameTermWithClient,
} from "@/lib/content/terms-core";
import { TERM_LIMIT_MESSAGE } from "@/lib/limits/messages";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";
import { contentTypes, enablePost } from "./content-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** M16-14: the term cap as the writer reports it. No database needed. */
describe("the term cap, as the writer reports it", () => {
  it("HL015 maps to term_limit, 403, with the limit message", () => {
    const out = mapDbError({ code: "HL015", message: "term limit reached" });
    expect(out).toEqual({
      ok: false,
      status: 403,
      error: "term_limit",
      message: TERM_LIMIT_MESSAGE,
    });
    expect(CONTENT_STATUS.term_limit).toBe(403);
    expect(CONTENT_MESSAGES.term_limit).toBe(TERM_LIMIT_MESSAGE);
    expect(TERM_LIMIT_MESSAGE).toContain("500");
  });

  it("HL010 still maps to entry_limit", () => {
    expect(mapDbError({ code: "HL010" })).toMatchObject({ error: "entry_limit", status: 403 });
  });
});

const { run } = await stackIsUp();
describe.skipIf(!run)("M16-14 terms: the list and the cap (local Supabase)", () => {
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
  const list = (o: TestOwner, over: { siteId?: string; typeKey?: string } = {}) =>
    listTermsWithClient(admin, { actor: actor(o), siteId: o.pageId, typeKey: "post", ...over });
  const term = (o: TestOwner, over: Partial<Parameters<typeof createTermWithClient>[1]> = {}) =>
    createTermWithClient(admin, {
      actor: actor(o),
      siteId: o.pageId,
      typeKey: "post",
      taxonomy: "tag",
      name: "Tag",
      slug: "tag",
      ...over,
    });

  beforeAll(async () => {
    a = await makeOwner(admin as never, "tl-a");
    b = await makeOwner(admin as never, "tl-b");
    owners.push(a, b);
    await enablePost(admin, a.pageId);
    await enablePost(admin, b.pageId);
  });
  afterAll(async () => removeOwners(admin as never, owners));

  it("a site with no terms lists none", async () => {
    expect(await list(a)).toEqual({ ok: true, terms: [] });
  });

  it("lists the type's categories, then its tags, by name, with the parent", async () => {
    const news = await term(a, { taxonomy: "category", name: "News", slug: "news" });
    if (!news.ok) throw new Error(news.message);
    const local = await term(a, {
      taxonomy: "category",
      name: "Local",
      slug: "local",
      parentId: news.id,
    });
    if (!local.ok) throw new Error(local.message);
    await term(a, { name: "zebra", slug: "zebra" });
    await term(a, { name: "Apple", slug: "apple" });
    const { post } = await contentTypes(admin, a.pageId);
    const out = await list(a);
    expect(out).toEqual({
      ok: true,
      terms: [
        {
          id: local.id,
          typeId: post.id,
          taxonomy: "category",
          name: "Local",
          slug: "local",
          parentId: news.id,
        },
        {
          id: news.id,
          typeId: post.id,
          taxonomy: "category",
          name: "News",
          slug: "news",
          parentId: null,
        },
        expect.objectContaining({ taxonomy: "tag", name: "Apple", slug: "apple", parentId: null }),
        expect.objectContaining({ taxonomy: "tag", name: "zebra", slug: "zebra", parentId: null }),
      ],
    });
  });

  it("another user's site, a malformed site id and an unknown type are the same not_found", async () => {
    const other = await list(b, { siteId: a.pageId });
    expect(other).toMatchObject({ ok: false, error: "not_found", status: 404 });
    expect(await list(a, { siteId: "nope" })).toEqual(other);
    expect(await list(a, { siteId: "00000000-0000-4000-8000-000000000000" })).toEqual(other);
    expect(await list(a, { typeKey: "recipes" })).toEqual(other);
    expect(JSON.stringify(other)).not.toContain("News");
  });

  it("the page type has no terms to list", async () => {
    expect(await list(a, { typeKey: "page" })).toEqual({ ok: true, terms: [] });
  });

  it("a term of another site is not_found for rename and delete, and stays as it was", async () => {
    const theirs = await term(b, { name: "Theirs", slug: "theirs" });
    if (!theirs.ok) throw new Error(theirs.message);
    expect(
      await renameTermWithClient(admin, {
        actor: actor(a),
        siteId: a.pageId,
        termId: theirs.id,
        name: "Mine now",
      }),
    ).toMatchObject({ ok: false, error: "not_found" });
    expect(
      await deleteTermWithClient(admin, { actor: actor(a), siteId: a.pageId, termId: theirs.id }),
    ).toMatchObject({ ok: false, error: "not_found" });
    // Naming the other site does not help either: it is not the caller's.
    expect(
      await deleteTermWithClient(admin, { actor: actor(a), siteId: b.pageId, termId: theirs.id }),
    ).toMatchObject({ ok: false, error: "not_found" });
    expect(await list(b)).toMatchObject({ ok: true, terms: [{ id: theirs.id, name: "Theirs" }] });
  });

  it("the terms stay readable while the blog is off, and for a suspended owner", async () => {
    await admin
      .from("content_types")
      .update({ enabled: false })
      .eq("site_id", b.pageId)
      .eq("key", "post");
    await admin
      .from("accounts")
      .update({ suspended_at: new Date().toISOString() })
      .eq("id", b.userId);
    expect(await list(b)).toMatchObject({ ok: true, terms: [{ name: "Theirs" }] });
    await admin.from("accounts").update({ suspended_at: null }).eq("id", b.userId);
    await enablePost(admin, b.pageId);
  });

  it("the 501st term of a type answers term_limit with the limit message, and is not stored", async () => {
    const { post } = await contentTypes(admin, a.pageId);
    const have = await list(a);
    if (!have.ok) throw new Error(have.message);
    const fill = Array.from({ length: 500 - have.terms.length }, (_, i) => ({
      site_id: a.pageId,
      type_id: post.id,
      taxonomy: i % 2 === 0 ? "tag" : "category",
      name: `Fill ${i}`,
      slug: `fill-${i}`,
    }));
    const filled = await admin.from("content_terms").insert(fill);
    expect(filled.error).toBeNull();

    const out = await term(a, { name: "One too many", slug: "one-too-many" });
    expect(out).toEqual({
      ok: false,
      status: 403,
      error: "term_limit",
      message: TERM_LIMIT_MESSAGE,
    });
    const all = await list(a);
    expect(all.ok && all.terms.length).toBe(500);
    expect(all.ok && all.terms.some((t) => t.slug === "one-too-many")).toBe(false);

    // Another site of another owner is not affected, and deleting one makes room.
    expect(await term(b, { name: "Free", slug: "free" })).toMatchObject({ ok: true });
    const gone = all.ok ? all.terms[0]! : null;
    expect(
      await deleteTermWithClient(admin, { actor: actor(a), siteId: a.pageId, termId: gone!.id }),
    ).toMatchObject({ ok: true });
    expect(await term(a, { name: "Room", slug: "room" })).toMatchObject({ ok: true });
  });
});
