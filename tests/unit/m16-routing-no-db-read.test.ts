import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M16-03, M16-05, M16-09 (the reads' side): what a request under an archive costs. The Data Cache is
 * a memo here (as `unstable_cache` is in production) and the secret-key client counts every query,
 * so a test can say "this request read Postgres n times". An invented path must cost cached reads
 * only: a first segment that is not an enabled archive, an invented slug, a page number past the
 * end, an unknown term.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  },
}));

const cacheCalls: { key: string[]; tags: string[]; args: unknown[] }[] = [];
const memo = new Map<string, Promise<unknown>>();
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, key: string[], options: { tags: string[] }) =>
    (...args: unknown[]) => {
      cacheCalls.push({ key, tags: options.tags, args });
      const id = JSON.stringify([key, args]);
      if (!memo.has(id)) memo.set(id, fn(...args));
      return memo.get(id)!;
    },
}));
vi.mock("next/server", () => ({ after: () => undefined }));

const SITE = "00000000-0000-4000-8000-0000000000b1";
const OWNER = "00000000-0000-4000-8000-0000000000c1";
const TYPE = "00000000-0000-4000-8000-0000000000d1";
const TERM = "00000000-0000-4000-8000-0000000000e1";
const EMPTY_TERM = "00000000-0000-4000-8000-0000000000e2";
const post = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The fixture the fake database answers from. */
const db = {
  enabled: true,
  posts: 12,
  redirects: [] as { from_slug: string; entry_id: string }[],
  queries: [] as string[],
};

const day = (n: number) => new Date(Date.UTC(2026, 10, 20) - n * 86_400_000).toISOString();
const indexRow = (n: number) => ({
  id: post(n),
  live_slug: `post-${n}`,
  first_published_at: day(n),
  published_at: day(n),
  title: `Post ${n}`,
  noindex: null,
});
const cardRow = (n: number) => ({
  ...indexRow(n),
  excerpt: `Excerpt ${n}`,
  body: "Body",
  featuredImage: null,
  categories: [TERM],
});

interface Query {
  table: string;
  select: string;
  filters: Record<string, unknown>;
  range?: [number, number];
}

function answer(query: Query): { data: unknown; error: null; count?: number } {
  const { table, select, filters } = query;
  db.queries.push(`${table}:${select.slice(0, 40)}`);
  if (table === "content_types") {
    if (select.startsWith("archive_path")) {
      return { data: { archive_path: "blog", enabled: db.enabled }, error: null };
    }
    if (filters.key === "page") return { data: { id: "page-type" }, error: null };
    return {
      data: db.enabled
        ? [{ id: TYPE, key: "post", label: "Post", label_plural: "Posts", archive_path: "blog" }]
        : [],
      error: null,
    };
  }
  if (table === "pages") return { data: { owner_id: OWNER }, error: null };
  if (table === "content_slug_redirects") return { data: db.redirects, error: null };
  if (table === "rpc:live_term_counts") {
    return {
      data: [
        {
          id: TERM,
          taxonomy: "category",
          slug: "news",
          name: "News",
          parent_id: null,
          live_count: 11,
        },
        {
          id: EMPTY_TERM,
          taxonomy: "tag",
          slug: "empty",
          name: "Empty",
          parent_id: null,
          live_count: 0,
        },
      ],
      error: null,
    };
  }
  if (table === "content_entries") {
    const all = Array.from({ length: db.posts }, (_, i) => i + 1);
    if (select.includes("noindex")) {
      const [from, to] = query.range ?? [0, 999];
      return { data: all.slice(from, to + 1).map(indexRow), error: null, count: db.posts };
    }
    if (select.includes("excerpt")) {
      const ids = filters["in:id"] as string[] | undefined;
      const rows = ids
        ? all.filter((n) => ids.includes(post(n)))
        : all.slice(query.range?.[0] ?? 0, (query.range?.[1] ?? 9) + 1);
      return { data: rows.map(cardRow), error: null, count: rows.length };
    }
    if (select.includes("content_types!inner")) return { data: [], error: null };
    if (select.startsWith("id, live_path")) return { data: [], error: null };
    if (select === "live_slug") {
      const n = all.find((candidate) => post(candidate) === filters.id);
      return { data: n ? { live_slug: `post-${n}` } : null, error: null };
    }
    if (select === "id") {
      const slug = filters.live_slug as string | undefined;
      const n = all.find((candidate) => `post-${candidate}` === slug);
      return { data: n ? { id: post(n) } : null, error: null };
    }
    if (select.startsWith("id, type_id, published")) {
      const n = all.find((candidate) => post(candidate) === filters.id);
      return {
        data: n
          ? {
              id: post(n),
              type_id: TYPE,
              published: { title: `Post ${n}`, slug: `post-${n}`, body: "Hello **world**." },
              published_at: day(n),
              first_published_at: day(n),
            }
          : null,
        error: null,
      };
    }
  }
  throw new Error(`unexpected query: ${table} ${select}`);
}

function builder(table: string) {
  const query: Query = { table, select: "", filters: {} };
  const chain: Record<string, unknown> = {
    select(columns: string) {
      query.select = columns;
      return chain;
    },
    eq(column: string, value: unknown) {
      query.filters[column] = value;
      return chain;
    },
    in(column: string, value: unknown) {
      query.filters[`in:${column}`] = value;
      return chain;
    },
    range(from: number, to: number) {
      query.range = [from, to];
      return chain;
    },
    maybeSingle() {
      return Promise.resolve(answer(query));
    },
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      return Promise.resolve()
        .then(() => answer(query))
        .then(resolve, reject);
    },
  };
  for (const name of ["neq", "is", "not", "order", "limit", "filter"]) chain[name] = () => chain;
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => builder(table),
    rpc: (name: string) => builder(`rpc:${name}`),
  }),
}));

const siteState = { kind: "published" as string };
vi.mock("@/app/(tenant)/published-page", async () => {
  const { fullPublished } = await import("./fixtures/page-document");
  const page = {
    pageId: SITE,
    plan: "pro",
    publishedAt: "2026-11-01T00:00:00.000Z",
    document: { ...fullPublished, blocks: [] },
  };
  const state = () => (siteState.kind === "published" ? { kind: "published", page } : siteState);
  return {
    getTenantSiteState: vi.fn(async () => state()),
    getTenantPageStateById: vi.fn(async () => state()),
  };
});
vi.mock("@/lib/domains/primary", () => ({ getPrimaryDomain: vi.fn(async () => null) }));

const { handleArchiveResponse, siteArchiveResponse } =
  await import("@/lib/tenant-render/blog-respond");
const { handleSubPageResponse } = await import("@/lib/tenant-render/respond");
const { archiveRoute } = await import("@/lib/routing/archive-paths");
const { archivePages } = await import("@/lib/tenant-render/archive-html");
const { PUBLIC_READ_CACHE_VERSION: V } = await import("@/lib/publish/tags");
const blog = await import("@/lib/blog/published");

const get = (path: string) => handleArchiveResponse("mara", archiveRoute(path));
/** The Postgres queries one call made. */
async function reads(run: () => Promise<unknown>): Promise<string[]> {
  db.queries.length = 0;
  await run();
  return [...db.queries];
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  memo.clear();
  cacheCalls.length = 0;
  db.enabled = true;
  db.posts = 12;
  db.redirects = [];
  db.queries.length = 0;
  siteState.kind = "published";
});

describe("M16-03 an invented path costs cached reads only", () => {
  it("a second segment under a first segment that is not an archive: the plain 404, no Postgres read on a warm cache", async () => {
    expect((await get("/blog/post-1")).status).toBe(200); // warms the site's cached reads
    for (const path of ["/shop/anything", "/shop/page/2", "/shop/category/x", "/shop/feed.xml"]) {
      let response!: Response;
      const made = await reads(async () => {
        response = await get(path);
      });
      // Only the archives of the site are consulted, and they are cached: nothing is read.
      expect(made, path).toEqual([]);
      expect(response.status, path).toBe(404);
      expect(await response.text()).not.toContain("Post 1");
    }
    // And no cache entry of its own: every key asked for is one of the site's or the type's.
    const keys = new Set(cacheCalls.map((call) => call.key.join("|")));
    expect([...keys].filter((key) => /shop|anything/.test(key))).toEqual([]);
  });

  it("with the blog off the same holds for /blog itself: one cached read says there is no archive", async () => {
    db.enabled = false;
    expect((await get("/blog/post-1")).status).toBe(404);
    expect(await reads(() => get("/blog/post-2"))).toEqual([]);
    expect(await reads(() => get("/blog/feed.xml"))).toEqual([]);
    expect((await handleSubPageResponse("mara", "blog")).status).toBe(404);
  });

  it("an invented slug, a page past the end and an unknown term under a real archive: 404 from the cached indexes", async () => {
    await get("/blog/post-1");
    await get("/blog/category/news");
    await get("/blog/old-thing"); // the redirect list is read once
    for (const path of [
      "/blog/never-written",
      "/blog/another-one",
      "/blog/page/3",
      "/blog/page/9999",
      "/blog/category/unknown",
      "/blog/tag/empty",
      "/blog/tag/news",
      "/blog/category/news/page/3",
    ]) {
      let response!: Response;
      const made = await reads(async () => {
        response = await get(path);
      });
      expect(made, path).toEqual([]);
      expect(response.status, path).toBe(404);
    }
    const keys = cacheCalls.map((call) => call.key.join("|"));
    expect(keys.filter((key) => /never-written|another-one|unknown|9999/.test(key))).toEqual([]);
    // No argument of any cached call holds what the visitor typed either.
    const args = JSON.stringify(cacheCalls.map((call) => call.args));
    expect(args).not.toMatch(/never-written|another-one|unknown/);
  });

  it("a real post and a real page are served from the cache the second time", async () => {
    for (const path of ["/blog/post-3", "/blog/page/2", "/blog/category/news", "/blog/feed.xml"]) {
      expect((await get(path)).status, path).toBe(200);
      expect(await reads(() => get(path)), path).toEqual([]);
    }
  });

  it("a null route (params that are no shape) reads nothing at all", async () => {
    expect(await reads(() => handleArchiveResponse("mara", null))).toEqual([]);
    expect((await siteArchiveResponse(SITE, null)).status).toBe(404);
    expect(cacheCalls).toEqual([]);
  });

  it("only a type with more live posts than the index holds pays one indexed read for a missing slug, never cached", async () => {
    db.posts = 5001;
    await get("/blog/post-1");
    await get("/blog/never-written"); // the redirect list is read once, under the type's tag
    expect(await reads(() => get("/blog/never-written-2"))).toEqual(["content_entries:id"]);
    expect(await reads(() => get("/blog/never-written"))).toEqual(["content_entries:id"]);
    expect(cacheCalls.map((call) => call.key.join("|")).filter((k) => k.includes("never"))).toEqual(
      [],
    );
  });
});

describe("M16-04 M16-05 published only, and only for a published site", () => {
  it.each(["unpublished", "missing", "suspended"])(
    "a %s site answers 404 for every shape and reads no post",
    async (kind) => {
      siteState.kind = kind;
      for (const path of [
        "/blog/post-1",
        "/blog/page/2",
        "/blog/category/news",
        "/blog/feed.xml",
      ]) {
        const made = await reads(async () => {
          const response = await get(path);
          expect(response.status, path).toBe(404);
          expect(await response.text()).not.toContain("Post 1");
        });
        expect(made, path).toEqual([]);
      }
    },
  );

  it("every read of content_entries is limited to live rows", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/blog/published.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bdraft\b/);
    const reads = code.split('.from("content_entries")').slice(1);
    expect(reads.length).toBeGreaterThanOrEqual(4);
    for (const read of reads) {
      const statement = read.slice(0, read.indexOf(";"));
      expect(statement).toMatch(/\.is\("deleted_at", null\)/);
      expect(statement).toMatch(/\.not\("published", "is", null\)/);
    }
  });
});

describe("M16-09 the key and the tags of each cached read", () => {
  it("names the site, the type or the entry, never a path", async () => {
    await get("/blog/post-3");
    await get("/blog/page/2");
    await get("/blog/category/news");
    await get("/blog/feed.xml");
    await get("/blog/gone");
    await blog.getLatestPosts(SITE, TYPE);
    const byName = new Map(cacheCalls.map((call) => [call.key[0], call]));
    const expectRead = (name: string, key: string[], tags: string[]) => {
      expect(byName.get(name)?.key, name).toEqual(key);
      expect(byName.get(name)?.tags, name).toEqual(tags);
    };
    expectRead("tenant-site-archives", ["tenant-site-archives", V, SITE], [`page:${SITE}`]);
    expectRead("tenant-site-owner", ["tenant-site-owner", V, SITE], [`page:${SITE}`]);
    expectRead(
      "tenant-post-index",
      ["tenant-post-index", V, TYPE],
      [`type:${TYPE}`, `page:${SITE}`],
    );
    expectRead("tenant-term-index", ["tenant-term-index", V, TYPE], [`type:${TYPE}`]);
    expectRead("tenant-slug-redirects", ["tenant-slug-redirects", V, TYPE], [`type:${TYPE}`]);
    expectRead(
      "tenant-latest-posts",
      ["tenant-latest-posts", V, TYPE],
      [`type:${TYPE}`, `page:${SITE}`],
    );
    expectRead("tenant-feed", ["tenant-feed", V, TYPE], [`type:${TYPE}`, `page:${SITE}`]);
    // Post HTML: the entry's tag and the site's, NOT the type's (post B never re-renders post A).
    expectRead(
      "tenant-post-html",
      ["tenant-post-html", V, post(3)],
      [`entry:${post(3)}`, `page:${SITE}`],
    );
    const archives = cacheCalls.filter((call) => call.key[0] === "tenant-archive-html");
    expect(archives.map((call) => call.key)).toEqual([
      ["tenant-archive-html", V, TYPE, "", "2"],
      ["tenant-archive-html", V, TYPE, TERM, "1"],
    ]);
    for (const call of archives) expect(call.tags).toEqual([`type:${TYPE}`, `page:${SITE}`]);
  });

  it("the previous and next links are stitched outside the cached post HTML", async () => {
    const first = await (await get("/blog/post-3")).text();
    expect(first).toContain('rel="prev" href="/blog/post-4"');
    expect(first).toContain('rel="next" href="/blog/post-2"');
    expect(first).not.toContain("<!--hl-post-nav-->");
    const cached = (await [...memo.entries()].find(([id]) =>
      id.includes("tenant-post-html"),
    )![1]) as string;
    expect(cached).toContain("<!--hl-post-nav-->");
    expect(cached).not.toContain('class="pg-post-navlink"');
    // The index changes (post 2 is gone): the same cached HTML now links elsewhere.
    for (const id of [...memo.keys()]) if (id.includes("tenant-post-index")) memo.delete(id);
    db.posts = 3;
    const after = await (await get("/blog/post-3")).text();
    expect(after).not.toContain('rel="prev"');
    expect(after).toContain('rel="next" href="/blog/post-2"');
  });
});

describe("M16-05 an archive page reads the cached index and one page of cards", () => {
  it("page 2 of 12 posts: the index, then one cards query for its two ids", async () => {
    await get("/blog/post-1");
    const made = await reads(() => get("/blog/page/2"));
    expect(made.filter((query) => query.startsWith("content_entries"))).toHaveLength(1);
    const html = await (await get("/blog/page/2")).text();
    expect(html).toContain("Post 11");
    expect(html).toContain("Post 12");
    expect(html).not.toContain("Post 10<");
    expect(html).toContain("Page 2 of 2");
  });

  it("paging maths at 0, 10, 11 and 5,001 posts", () => {
    expect(archivePages(0, 10)).toBe(1);
    expect(archivePages(1, 10)).toBe(1);
    expect(archivePages(10, 10)).toBe(1);
    expect(archivePages(11, 10)).toBe(2);
    expect(archivePages(5001, 10)).toBe(501);
    expect(archivePages(-3, 10)).toBe(1);
    expect(archivePages(Number.NaN, 10)).toBe(1);
  });

  it.each([
    [0, "/blog/page/2", 404],
    [10, "/blog/page/2", 404],
    [11, "/blog/page/2", 200],
    [11, "/blog/page/3", 404],
    [5001, "/blog/page/501", 200],
    [5001, "/blog/page/502", 404],
  ])("%i posts: %s answers %i", async (posts, path, status) => {
    db.posts = posts;
    expect((await get(path)).status).toBe(status);
  });

  it("an empty blog has its page 1, reading 'No posts yet'", async () => {
    db.posts = 0;
    const response = await handleSubPageResponse("mara", "blog");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("No posts yet");
  });
});

describe("M16-10 a changed slug redirects, from the vetted slug only", () => {
  it("an old slug of a live post answers 301 to its current address; a live post with that slug wins", async () => {
    db.redirects = [
      { from_slug: "old-name", entry_id: post(4) },
      { from_slug: "post-2", entry_id: post(4) },
      { from_slug: "dead", entry_id: post(999) },
      { from_slug: "constructor", entry_id: post(5) },
    ];
    const moved = await get("/blog/old-name");
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/blog/post-4");
    // A redirect row whose entry is not live any more is the 404, not a redirect to nothing.
    expect((await get("/blog/dead")).status).toBe(404);
    // A live post with the slug is served; the redirect row is never consulted for it.
    const live = await get("/blog/post-2");
    expect(live.status).toBe(200);
    expect(await live.text()).toContain("Post 2");
    // Not in the list: the 404, and object keys are not slugs.
    expect((await get("/blog/tostring")).status).toBe(404);
    expect((await get("/blog/constructor")).status).toBe(301);
    expect((await get("/blog/valueof")).status).toBe(404);
  });

  it("past the index (more than 5,000 live posts): the target is found by one published-only read, cached under the type's tag", async () => {
    db.posts = 5001;
    // post(5001) is the oldest live post: it is not in the index of the newest 5,000.
    db.redirects = [
      { from_slug: "very-old-name", entry_id: post(5001) },
      { from_slug: "gone-name", entry_id: post(9999) },
    ];
    const moved = await get("/blog/very-old-name");
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/blog/post-5001");
    expect(await reads(() => get("/blog/very-old-name"))).toEqual([]);
    const read = cacheCalls.find((call) => call.key[0] === "tenant-redirect-target");
    expect(read?.key).toEqual(["tenant-redirect-target", V, TYPE, post(5001)]);
    expect(read?.tags).toEqual([`type:${TYPE}`]);
    // A row naming a post that is not live: the 404, and a warm cache reads nothing for it either.
    expect((await get("/blog/gone-name")).status).toBe(404);
    expect(await reads(() => get("/blog/gone-name"))).toEqual([]);
    // A live post past the index is still found by its own slug.
    expect((await get("/blog/post-5001")).status).toBe(200);
  });

  it("the lookup is a cached read under the type's tag", async () => {
    db.redirects = [{ from_slug: "old-name", entry_id: post(4) }];
    await get("/blog/old-name");
    expect(await reads(() => get("/blog/old-name"))).toEqual([]);
  });
});

describe("isLivePost and findLivePostId (the beacon's questions)", () => {
  it("answer from the cached index: a live post is, a random id and another shape are not", async () => {
    expect(await blog.isLivePost(SITE, post(3))).toBe(true);
    expect(await reads(() => blog.isLivePost(SITE, post(3)))).toEqual([]);
    expect(await reads(() => blog.isLivePost(SITE, post(900)))).toEqual([]);
    expect(await blog.isLivePost(SITE, post(900))).toBe(false);
    expect(await blog.isLivePost(SITE, "not-a-uuid")).toBe(false);
    expect(await blog.isLivePost("nope", post(3))).toBe(false);
    expect(await blog.findLivePostId(SITE, TYPE, "post-3")).toBe(post(3));
    expect(await blog.findLivePostId(SITE, TYPE, "Post-3")).toBeNull();
    expect(await blog.findLivePostId(SITE, TYPE, "page")).toBeNull();
  });
});
