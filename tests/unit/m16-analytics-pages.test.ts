// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M16-11: what the beacon's site lookup says about the blog. The archive ids come from the blog's
 * own cached read of THIS site, the post check is bound to THIS site's id (the request never names
 * the site it is checked against), and a blog read that fails never stops Home's views.
 */

const SITE = "00000000-0000-4000-8000-0000000000b1";
const OTHER_SITE = "00000000-0000-4000-8000-0000000000c2";
const POST_TYPE = "44444444-4444-4444-8444-444444444444";
const POST = "55555555-5555-4555-8555-555555555555";

const blog = vi.hoisted(() => ({ getSiteArchives: vi.fn(), isLivePost: vi.fn() }));
const db = vi.hoisted(() => ({ page: null as unknown, reads: 0 }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn(async () => null) }));
vi.mock("@/lib/blog/published", () => blog);
vi.mock("@/lib/site/published", () => ({ getPublishedSubPage: vi.fn() }));
vi.mock("@/lib/site/page-entries", () => ({
  getPublishedHomeWithClient: vi.fn(),
  listLivePagesWithClient: vi.fn(async () => [{ id: "AAAAAAAA-AAAA-4AAA-8AAA-000000000001" }]),
  mergeHomePublished: vi.fn(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    from: () => {
      db.reads += 1;
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        maybeSingle: async () => ({ data: db.page, error: null }),
      };
      return query;
    },
  }),
}));

import { lookupBeaconPage } from "@/lib/analytics/ingest/pages";

const livePage = {
  handle: "mara",
  accounts: { suspended_at: null },
  domains: [{ hostname: "Links.Example.test", status: "verified" }],
};

describe("M16-11 the beacon's site lookup and the blog", () => {
  beforeEach(() => {
    db.page = livePage;
    db.reads = 0;
    blog.getSiteArchives.mockReset();
    blog.isLivePost.mockReset();
    blog.getSiteArchives.mockResolvedValue({
      archives: [
        {
          typeId: POST_TYPE.toUpperCase(),
          key: "post",
          path: "blog",
          label: "Post",
          labelPlural: "Posts",
          pageSize: 10,
        },
      ],
      pagesWithPostLists: [],
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("names the site's enabled archives (lower case), read for this site only", async () => {
    const page = await lookupBeaconPage(SITE);
    expect(page).toMatchObject({
      handle: "mara",
      customHosts: ["links.example.test"],
      subPageIds: ["aaaaaaaa-aaaa-4aaa-8aaa-000000000001"],
      archiveTypeIds: [POST_TYPE],
    });
    expect(blog.getSiteArchives).toHaveBeenCalledTimes(1);
    expect(blog.getSiteArchives).toHaveBeenCalledWith(SITE);
  });

  it("the post check is bound to the looked-up site, whatever id is asked", async () => {
    blog.isLivePost.mockImplementation(async (siteId: string, id: string) => {
      return siteId === SITE && id === POST;
    });
    const page = await lookupBeaconPage(SITE);
    expect(await page!.isLivePost!(POST)).toBe(true);
    expect(blog.isLivePost).toHaveBeenLastCalledWith(SITE, POST);
    // The same post id asked through another site's lookup is checked against THAT site: no.
    const other = await lookupBeaconPage(OTHER_SITE);
    expect(await other!.isLivePost!(POST)).toBe(false);
    expect(blog.isLivePost).toHaveBeenLastCalledWith(OTHER_SITE, POST);
  });

  it("the post check is not asked by the lookup itself, and makes no query of its own here", async () => {
    await lookupBeaconPage(SITE);
    expect(blog.isLivePost).not.toHaveBeenCalled();
    const readsOfLookup = db.reads;
    blog.isLivePost.mockResolvedValue(false);
    const page = await lookupBeaconPage(SITE);
    db.reads = 0;
    await page!.isLivePost!(POST);
    expect(db.reads).toBe(0);
    expect(readsOfLookup).toBe(1);
  });

  it("an unpublished or suspended site is null and the blog is never read", async () => {
    for (const row of [null, { ...livePage, accounts: { suspended_at: "2026-11-01T00:00:00Z" } }]) {
      db.page = row;
      expect(await lookupBeaconPage(SITE)).toBeNull();
    }
    expect(blog.getSiteArchives).not.toHaveBeenCalled();
  });

  it("a failing archive read is logged and reads as no archive: Home still counts", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    blog.getSiteArchives.mockRejectedValue(new Error("archives down"));
    const page = await lookupBeaconPage(SITE);
    expect(page).toMatchObject({ handle: "mara", archiveTypeIds: [] });
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
