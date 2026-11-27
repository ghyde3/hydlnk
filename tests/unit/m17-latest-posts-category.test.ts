// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { contentTypes, enablePost } from "./content-support";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

/**
 * M16-07: a latest-posts block with a category lists that category's newest live posts, however
 * many newer posts of other categories the blog has (the block used to filter the 12 newest only).
 * Against the local database, through the real `publish_entry`.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  },
}));
const session = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: session.getSessionUser }));

const { run } = await stackIsUp();

describe.skipIf(!run)("latest posts by category", () => {
  const admin = run
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SECRET_KEY!,
        { auth: { persistSession: false } },
      )
    : (undefined as unknown as SupabaseClient<Database>);
  const owners: TestOwner[] = [];
  let owner: TestOwner;
  let typeId: string;
  let old: string;
  const oldPosts: string[] = [];

  beforeAll(async () => {
    owner = await makeOwner(admin as never, "lp-a", undefined, "pro");
    owners.push(owner);
    await enablePost(admin, owner.pageId);
    typeId = (await contentTypes(admin, owner.pageId)).post.id;
    const term = await admin
      .from("content_terms")
      .insert({
        site_id: owner.pageId,
        type_id: typeId,
        taxonomy: "category",
        name: "Old",
        slug: "old",
      })
      .select("id")
      .single();
    if (term.error) throw new Error(term.error.message);
    old = term.data.id;
    // Two old posts in the category, then 14 newer posts without it.
    const day = 86_400_000;
    for (let n = 0; n < 16; n += 1) {
      const inCategory = n < 2;
      const doc = {
        title: `Post ${n}`,
        slug: `post-${n}`,
        body: "Hello.",
        ...(inCategory ? { terms: { categories: [old] } } : {}),
      };
      const made = await admin
        .from("content_entries")
        .insert({ site_id: owner.pageId, type_id: typeId, draft: doc as never })
        .select("id")
        .single();
      if (made.error) throw new Error(made.error.message);
      const published = await admin.rpc("publish_entry", {
        p_entry_id: made.data.id,
        p_owner_id: owner.userId,
        p_expected_rev: 1,
        p_published: doc as never,
        p_published_at: new Date(Date.UTC(2026, 0, 1) + n * day).toISOString(),
      });
      if (published.error) throw new Error(published.error.message);
      if (inCategory) oldPosts.push(made.data.id);
    }
  }, 60_000);
  afterAll(async () => removeOwners(admin as never, owners));

  it("without a category: the 12 newest; with it: the category's posts are there too, newest first", async () => {
    const { getLatestPosts, LATEST_POSTS_READ } = await import("@/lib/blog/published");
    const plain = await getLatestPosts(owner.pageId, typeId);
    expect(plain?.posts).toHaveLength(LATEST_POSTS_READ);
    expect(plain?.posts.some((post) => post.categoryIds.includes(old))).toBe(false);

    const withCategory = await getLatestPosts(owner.pageId, typeId, [old]);
    const inCategory = withCategory!.posts.filter((post) => post.categoryIds.includes(old));
    expect(inCategory.map((post) => post.id)).toEqual([...oldPosts].reverse());
    // Still in archive order overall, each post once.
    const dates = withCategory!.posts.map((post) => post.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(withCategory!.posts.map((post) => post.id)).size).toBe(
      withCategory!.posts.length,
    );
  });

  it("a live page's latest-posts block with that category draws those older posts", async () => {
    const { latestPostsCategories } = await import("@/lib/site/live");
    const blocks = [
      { type: "latest_posts", id: "b1", categoryId: old, count: 3 },
      { type: "latest_posts", id: "b2", count: 3 },
      { type: "text", id: "b3" },
    ];
    expect(latestPostsCategories(blocks)).toEqual([old]);
  });

  it("the editor's preview route reads a block's category too, a real category of the blog only", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/(editor)/app/api/pages/[id]/posts/latest/route");
    session.getSessionUser.mockResolvedValue({ id: owner.userId });
    const call = async (query: string) => {
      const response = await GET(
        new NextRequest(`http://app.localhost:3000/api/pages/${owner.pageId}/posts/latest${query}`),
        { params: Promise.resolve({ id: owner.pageId }) },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { latest: { posts: Array<{ id: string }> } };
    };
    const plain = await call("");
    expect(plain.latest.posts.filter((post) => oldPosts.includes(post.id))).toEqual([]);
    const asked = await call(`?categories=${old},00000000-0000-4000-8000-000000000999`);
    expect(asked.latest.posts.filter((post) => oldPosts.includes(post.id))).toHaveLength(2);
  });

  it("an unknown or malformed category reads nothing more", async () => {
    const { getLatestPosts, LATEST_POSTS_READ } = await import("@/lib/blog/published");
    const out = await getLatestPosts(owner.pageId, typeId, [
      "not-a-uuid",
      "00000000-0000-4000-8000-000000000999",
    ]);
    expect(out?.posts).toHaveLength(LATEST_POSTS_READ);
  });
});
