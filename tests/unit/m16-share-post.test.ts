import { describe, expect, it, vi } from "vitest";
import { emptyDraft } from "@/lib/document";
import { hashPreviewToken } from "@/lib/previews/token";
import { sharePath } from "@/lib/previews/share-headers";
import { sanitizeSharedPost } from "@/lib/previews/sanitize";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/client", () => ({
  clientEnv: {
    NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  },
}));

/**
 * M16-16: `/share/{token}/entry/{entryId}` draws one post's saved draft. The share preview is the
 * only place a draft is shown, so the rules are proven against a client that really filters: the
 * site comes from the link's row and nothing else, the entry must be an untrashed post of THAT site,
 * and every other answer (another site's entry, a page entry, a trashed post, a malformed tail, a
 * dead link) is the one `inactive`. A tail that is not exactly `entry/{uuid}` never makes a query.
 */

const TOKEN = "a".repeat(43);
const OTHER_TOKEN = "b".repeat(43);
const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_SITE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PAGE_TYPE = "10000000-0000-4000-8000-000000000001";
const POST_TYPE = "10000000-0000-4000-8000-000000000002";
const OTHER_POST_TYPE = "10000000-0000-4000-8000-000000000003";
const HOME_ENTRY = "20000000-0000-4000-8000-000000000001";
const PAGE_ENTRY = "20000000-0000-4000-8000-000000000002";
const POST = "20000000-0000-4000-8000-000000000003";
const TRASHED_POST = "20000000-0000-4000-8000-000000000004";
const OTHER_SITE_POST = "20000000-0000-4000-8000-000000000005";
const BROKEN_POST = "20000000-0000-4000-8000-000000000006";
const CATEGORY = "30000000-0000-4000-8000-000000000001";
const TAG = "30000000-0000-4000-8000-000000000002";
const OTHER_SITE_TERM = "30000000-0000-4000-8000-000000000003";

const { blocks: homeBlocks, ...design } = {
  ...emptyDraft("zq"),
  nav: { show: true, items: [PAGE_ENTRY] },
};

const postDraft = {
  title: "A draft‮ post\u0007",
  slug: "a-draft-post",
  excerpt: "Line one\nline⁦ two",
  body: "# Heading\n\n<script>alert(1)</script>\n\nText‮ here\u0000.\n\n\tcode",
  featuredImage: { path: `${OWNER}/abcdefgh.webp`, width: 1200, height: 800 },
  seo: { title: "SEO‮ title", description: "SEO description" },
  terms: { categories: [CATEGORY, OTHER_SITE_TERM], tags: [TAG] },
};

type Row = Record<string, unknown>;
interface Query {
  table: string;
  select: string;
  eq: Record<string, unknown>;
}

function tables(link: Row | null = {}): Record<string, Row[]> {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  return {
    preview_links:
      link === null
        ? []
        : [
            {
              token_hash: hashPreviewToken(TOKEN),
              expires_at: future,
              revoked_at: null,
              pages: {
                id: SITE,
                handle: "zq",
                owner_id: OWNER,
                draft: design,
                accounts: { plan: "free", suspended_at: null },
              },
              ...link,
            },
          ],
    content_types: [
      { id: PAGE_TYPE, site_id: SITE, key: "page", archive_path: null },
      { id: POST_TYPE, site_id: SITE, key: "post", archive_path: "blog" },
      { id: OTHER_POST_TYPE, site_id: OTHER_SITE, key: "post", archive_path: "blog" },
    ],
    content_entries: [
      {
        id: HOME_ENTRY,
        site_id: SITE,
        type_id: PAGE_TYPE,
        deleted_at: null,
        rev: 1,
        draft: { path: "/", title: "", description: "", blocks: homeBlocks },
      },
      {
        id: PAGE_ENTRY,
        site_id: SITE,
        type_id: PAGE_TYPE,
        deleted_at: null,
        rev: 1,
        published: null,
        live_path: null,
        created_at: "2026-01-01T00:00:00Z",
        draft: { path: "items", title: "Items", description: "", blocks: [] },
      },
      {
        id: POST,
        site_id: SITE,
        type_id: POST_TYPE,
        deleted_at: null,
        first_published_at: null,
        draft: postDraft,
      },
      {
        id: TRASHED_POST,
        site_id: SITE,
        type_id: POST_TYPE,
        deleted_at: "2026-11-01T00:00:00Z",
        first_published_at: null,
        draft: postDraft,
      },
      {
        id: OTHER_SITE_POST,
        site_id: OTHER_SITE,
        type_id: OTHER_POST_TYPE,
        deleted_at: null,
        first_published_at: null,
        draft: { ...postDraft, title: "SECRET of another site" },
      },
      {
        id: BROKEN_POST,
        site_id: SITE,
        type_id: POST_TYPE,
        deleted_at: null,
        first_published_at: null,
        draft: { title: 7, body: ["not", "a", "string"] },
      },
    ],
    content_terms: [
      {
        id: CATEGORY,
        site_id: SITE,
        type_id: POST_TYPE,
        taxonomy: "category",
        slug: "news",
        name: "News‮",
        position: 0,
      },
      {
        id: TAG,
        site_id: SITE,
        type_id: POST_TYPE,
        taxonomy: "tag",
        slug: "hello",
        name: "Hello",
        position: 0,
      },
      {
        id: OTHER_SITE_TERM,
        site_id: OTHER_SITE,
        type_id: OTHER_POST_TYPE,
        taxonomy: "category",
        slug: "theirs",
        name: "THEIR TERM",
        position: 0,
      },
    ],
    themes: [],
  };
}

/** A client that really filters (`eq`, `neq`, `is`, `in`, JSON `->>` paths), and records every read. */
function fakeAdmin(data: Record<string, Row[]>, queries: Query[] = []) {
  const read = (row: Row, column: string): unknown => {
    const [head, key] = column.split("->>");
    return key === undefined ? row[column] : (row[head!] as Row | undefined)?.[key];
  };
  return {
    queries,
    client: {
      from(table: string) {
        const query: Query = { table, select: "", eq: {} };
        queries.push(query);
        const tests: Array<(row: Row) => boolean> = [];
        const rows = () => (data[table] ?? []).filter((row) => tests.every((test) => test(row)));
        const chain = {
          select(columns: string) {
            query.select = columns;
            return chain;
          },
          eq(column: string, value: unknown) {
            query.eq[column] = value;
            tests.push((row) => read(row, column) === value);
            return chain;
          },
          neq(column: string, value: unknown) {
            tests.push((row) => read(row, column) !== value);
            return chain;
          },
          is(column: string, value: unknown) {
            tests.push((row) => (read(row, column) ?? null) === value);
            return chain;
          },
          in(column: string, values: unknown[]) {
            tests.push((row) => values.includes(read(row, column)));
            return chain;
          },
          not: () => chain,
          or: () => chain,
          order: () => chain,
          limit: () => chain,
          async maybeSingle() {
            return { error: null, data: rows()[0] ?? null };
          },
          then(resolve: (value: unknown) => void) {
            resolve({ error: null, data: rows() });
          },
        };
        return chain;
      },
    } as never,
  };
}

async function load(path: string, options: { token?: unknown; link?: Row | null } = {}) {
  const { loadSharedPreview } = await import("@/lib/previews/shared");
  const admin = fakeAdmin(tables(options.link));
  const result = await loadSharedPreview(
    admin.client,
    "token" in options ? options.token : TOKEN,
    new Date(),
    path,
  );
  return { result, queries: admin.queries };
}

describe("M16-16 the address", () => {
  it("the proxy hands entry/{id} over as the tail", () => {
    expect(sharePath(`/share/${TOKEN}/entry/${POST}`)).toBe(`entry/${POST}`);
    expect(sharePath(`/share/${TOKEN}/entry/${POST}/`)).toBe(`entry/${POST}`);
  });
});

describe("M16-16 loadSharedPreview of a post", () => {
  it("draws the saved draft of a post of the link's own site, with the site's draft design", async () => {
    const { result, queries } = await load(`entry/${POST}`);
    expect(result.kind).toBe("active");
    if (result.kind !== "active") return;
    expect(result.pageId).toBe(SITE);
    expect(result.doc.profile).toBeDefined();
    expect(result.subPage).toBeUndefined();
    expect(result.post).toBeDefined();
    const post = result.post!;
    expect(post.ownerId).toBe(OWNER);
    expect(post.archivePath).toBe("blog");
    // Never published: no date.
    expect(post.view.publishedAt).toBeNull();
    expect(post.view.featuredImage).toEqual(postDraft.featuredImage);

    // Hidden characters are out of every text; the body keeps its line breaks and its tab, and the
    // raw HTML stays in it as text for the renderer to show as text.
    expect(post.view.title).toBe("A draft post");
    expect(post.view.excerpt).toBe("Line one\nline two");
    expect(post.view.body).toBe("# Heading\n\n<script>alert(1)</script>\n\nText here.\n\n\tcode");

    // Only this site's terms, in the draft's order (categories, then tags), names cleaned.
    expect(post.terms).toEqual([
      { id: CATEGORY, taxonomy: "category", slug: "news", name: "News" },
      { id: TAG, taxonomy: "tag", slug: "hello", name: "Hello" },
    ]);

    // The menu is the draft's, every entry this link's own address, and nothing is marked current.
    expect(result.site?.menu?.items).toEqual([
      { label: "Home", href: `/share/${TOKEN}`, current: false },
      { label: "Items", href: `/share/${TOKEN}/items`, current: false },
    ]);

    // The post is read by (id, the LINK's site, the site's own Post type), untrashed.
    const entryRead = queries.find(
      (query) => query.table === "content_entries" && query.eq.id === POST,
    );
    expect(entryRead?.eq).toMatchObject({ id: POST, site_id: SITE, type_id: POST_TYPE });
    // Every read that names a site names the link's.
    for (const query of queries) {
      if ("site_id" in query.eq) expect(query.eq.site_id).toBe(SITE);
    }
    // Nothing published is selected for the post, and no account column beyond the link's own read.
    expect(entryRead?.select).not.toContain("published,");
  });

  it("the menu shows the Blog item when the blog is on and the menu names it, at its live address", async () => {
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    const data = tables();
    data.content_types = data.content_types!.map((type) =>
      type.id === POST_TYPE ? { ...type, enabled: true, label_plural: "Posts" } : type,
    );
    const withBlog = { ...design, nav: { show: true, items: [PAGE_ENTRY, POST_TYPE] } };
    (data.preview_links![0]!.pages as Row).draft = withBlog;
    for (const path of ["", "items", `entry/${POST}`]) {
      const result = await loadSharedPreview(fakeAdmin(data).client, TOKEN, new Date(), path);
      expect(result.kind).toBe("active");
      if (result.kind !== "active") continue;
      const items = result.site?.menu?.items ?? [];
      // The preview has no archive of its own: the item keeps the live address, which the frame
      // does not follow (only /share/{token}/{path} links are followed).
      expect(items.find((item) => item.label === "Posts")).toEqual({
        label: "Posts",
        href: "/blog",
        current: false,
      });
      expect(items.find((item) => item.label === "Items")?.href).toBe(`/share/${TOKEN}/items`);
    }
    // Off: no Blog item.
    const off = tables();
    (off.preview_links![0]!.pages as Row).draft = withBlog;
    const result = await loadSharedPreview(fakeAdmin(off).client, TOKEN, new Date(), "items");
    expect(result.kind === "active" && result.site?.menu?.items.map((item) => item.label)).toEqual([
      "Home",
      "Items",
    ]);
  });

  it("a published post shows its first publish date", async () => {
    const { loadSharedPreview } = await import("@/lib/previews/shared");
    const data = tables();
    data.content_entries!.find((row) => row.id === POST)!.first_published_at =
      "2026-11-20T10:00:00+00:00";
    const result = await loadSharedPreview(
      fakeAdmin(data).client,
      TOKEN,
      new Date(),
      `entry/${POST}`,
    );
    expect(result.kind === "active" && result.post?.view.publishedAt).toBe(
      "2026-11-20T10:00:00+00:00",
    );
  });

  it("another site's entry id is the one 404, and nothing of that entry is read into the answer", async () => {
    const { result } = await load(`entry/${OTHER_SITE_POST}`);
    expect(result).toEqual({ kind: "inactive" });
  });

  it("a page entry of the same site, a trashed post and an unknown id are the same 404", async () => {
    const unknown = "20000000-0000-4000-8000-00000000ffff";
    for (const id of [PAGE_ENTRY, HOME_ENTRY, TRASHED_POST, unknown]) {
      const { result } = await load(`entry/${id}`);
      expect(result, id).toEqual({ kind: "inactive" });
    }
  });

  it("a stored draft that is not a post's shape is the 404, not a crash", async () => {
    expect((await load(`entry/${BROKEN_POST}`)).result).toEqual({ kind: "inactive" });
  });

  it("a tail that is not exactly entry/{uuid} never reaches a query", async () => {
    for (const tail of [
      "entry/",
      "entry/not-a-uuid",
      `entry/${POST}/x`,
      `entry/${POST}/`,
      `entry//${POST}`,
      `Entry/${POST}`,
      // Canonical ids are lower case: an upper-case spelling of a real id is not an address.
      `entry/${POST.replace("2", "A")}`,
      "entry/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      `entry/${POST}?x=1`,
      `entry/${POST}%00`,
      `entry/${POST.slice(0, -1)}`,
      `entry/${POST}0`,
      `entry/ ${POST}`,
      `entries/${POST}`,
      `items/entry/${POST}`,
      `entry/${POST.replace(/-/g, "")}`,
      "~",
    ]) {
      const { result, queries } = await load(tail);
      expect(result, tail).toEqual({ kind: "inactive" });
      expect(queries, tail).toEqual([]);
    }
  });

  it("a malformed token never reaches a query, whatever the tail", async () => {
    for (const token of ["", "short", "a".repeat(44), null, undefined, 7, `${"a".repeat(42)}/`]) {
      const { result, queries } = await load(`entry/${POST}`, { token });
      expect(result).toEqual({ kind: "inactive" });
      expect(queries).toEqual([]);
    }
  });

  it("a dead link shows no post: unknown, revoked, expired or suspended, and no entry is read", async () => {
    const dead: Array<{ token?: unknown; link?: Row | null }> = [
      { token: OTHER_TOKEN },
      { link: null },
      { link: { revoked_at: "2026-11-01T00:00:00Z" } },
      { link: { expires_at: "2026-01-01T00:00:00Z" } },
      {
        link: {
          pages: {
            id: SITE,
            handle: "zq",
            owner_id: OWNER,
            draft: design,
            accounts: { plan: "free", suspended_at: "2026-11-01T00:00:00Z" },
          },
        },
      },
    ];
    for (const options of dead) {
      const { result, queries } = await load(`entry/${POST}`, options);
      expect(result).toEqual({ kind: "inactive" });
      expect(queries.map((query) => query.table)).toEqual(["preview_links"]);
    }
  });

  it("the token decides the site: a link of site X never shows a post of site Y", async () => {
    // The same request against a link whose row is the OTHER site: now only that site's post shows.
    const otherLink = {
      pages: {
        id: OTHER_SITE,
        handle: "other",
        owner_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        draft: design,
        accounts: { plan: "free", suspended_at: null },
      },
    };
    expect((await load(`entry/${POST}`, { link: otherLink })).result).toEqual({ kind: "inactive" });
    const theirs = await load(`entry/${OTHER_SITE_POST}`, { link: otherLink });
    expect(theirs.result.kind).toBe("active");
    for (const query of theirs.queries) {
      if ("site_id" in query.eq) expect(query.eq.site_id).toBe(OTHER_SITE);
    }
  });

  it("Home and a page of the site still load, with no post", async () => {
    const home = await load("");
    expect(home.result.kind === "active" && home.result.post).toBeUndefined();
    const page = await load("items");
    expect(page.result.kind === "active" && page.result.subPage?.title).toBe("Items");
    expect(page.result.kind === "active" && page.result.post).toBeUndefined();
  });
});

describe("M16-16 sanitizeSharedPost", () => {
  it("strips control and bidi characters from every text and keeps the body's line breaks and tabs", () => {
    const clean = sanitizeSharedPost({
      title: " T‮itle\u0000 ",
      excerpt: "a⁧\nb",
      body: "one\r\n\ttwo\u0007‭\n```\n\tx\n```",
      seo: { title: "S‮", description: "D\u0001", noindex: true },
    });
    expect(clean.title).toBe("Title");
    expect(clean.excerpt).toBe("a\nb");
    expect(clean.body).toBe("one\n\ttwo\n```\n\tx\n```");
    expect(clean.seo).toEqual({ title: "S", description: "D", noindex: true });
  });

  it("missing fields become empty text, and the input is not changed", () => {
    const input = { body: "x‮" };
    expect(sanitizeSharedPost(input)).toMatchObject({ title: "", excerpt: "", body: "x" });
    expect(input.body).toBe("x‮");
  });
});
