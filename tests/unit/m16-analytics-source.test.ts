// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

import {
  POST_LOOKUP_MAX,
  hiddenHistoryIds,
  readBlogPages,
  readViewedPosts,
} from "@/lib/analytics/dashboard/source";

/**
 * M16-11: the blog's entries of the Analytics page filter. Every read is keyed by the site the
 * owner lookup approved; only published titles are selected (never a draft or a body); a trashed
 * post is not asked for. The archive is read with the page (no stats table: a refused range must
 * read none); the posts are the ones with views in the range, read after the plan check.
 */

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const SITE = uuid(1);
const POST_TYPE = uuid(3);
const POST_A = uuid(4);
const POST_B = uuid(5);
const GONE = uuid(6);
const POST_C = uuid(7);
const POST_D = uuid(8);
const PAGE_ID = uuid(9);

interface Call {
  table: string;
  select: string;
  limit?: number;
  filters: Array<[string, string, unknown]>;
}

/** A spy client: records each read and answers from `tables` (rows are matched on `id in (...)`). */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: "", filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      for (const op of ["eq", "neq", "in", "is", "not", "gte", "gt"]) {
        builder[op] = (column: string, ...rest: unknown[]) => {
          call.filters.push([op, column, rest.length === 1 ? rest[0] : rest]);
          return builder;
        };
      }
      builder.select = (columns: string) => {
        call.select = columns;
        return builder;
      };
      builder.order = () => builder;
      builder.limit = (count: number) => {
        call.limit = count;
        return builder;
      };
      builder.then = (resolve: (value: unknown) => unknown) => {
        const ids = call.filters.find(([op, column]) => op === "in" && column === "id")?.[2];
        const rows = (tables[table] ?? []).filter(
          // Postgres compares uuids whatever their case.
          (row) => !Array.isArray(ids) || ids.includes(String(row.id).toLowerCase()),
        );
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return builder;
    },
  };
  return { db: client as unknown as SupabaseClient, calls };
}

const postType = { id: POST_TYPE, key: "post", label_plural: "Posts", enabled: true };

describe("M16-11 the stats source and the blog", () => {
  it("lists the archive as Blog and reads no post: posts are named by their views, after the plan check", async () => {
    const { db, calls } = fakeDb({
      content_types: [postType],
      content_entries: [{ id: POST_A, title: "Live title" }],
    });
    expect(await readBlogPages(db, SITE)).toEqual({
      archives: [{ id: POST_TYPE, title: "Blog" }],
      typeIds: [POST_TYPE],
      enabledTypeIds: [POST_TYPE],
    });
    expect(calls.map((call) => call.table)).toEqual(["content_types"]);
    expect(calls[0]!.filters).toContainEqual(["eq", "site_id", SITE]);
    expect(calls[0]!.filters).toContainEqual(["neq", "key", "page"]);
  });

  it("names the posts that have views in the range, most viewed first, by their published title", async () => {
    const { db, calls } = fakeDb({
      daily_stats: [
        { sub_page_id: POST_B, views: 2 },
        { sub_page_id: POST_A.toUpperCase(), views: 5 },
        { sub_page_id: POST_B, views: 4 },
        { sub_page_id: GONE, views: 9 },
        { sub_page_id: PAGE_ID, views: 30 },
      ],
      events: [{ sub_page_id: POST_C }, { sub_page_id: POST_A }],
      content_entries: [
        { id: POST_A.toUpperCase(), title: "Live title" },
        { id: POST_B, title: null },
        { id: POST_C, title: "Seen today" },
        { id: POST_D, title: "Never viewed" },
      ],
    });
    const posts = await readViewedPosts(db, SITE, {
      typeIds: [POST_TYPE],
      fromDay: "2026-09-01",
      listed: new Set([PAGE_ID, POST_TYPE]),
      selected: "all",
    });
    // POST_A 5 + 1, POST_B 2 + 4, POST_C 1. A post with no view in the range is not named; an id
    // that is no live post of the site (trashed, purged, foreign) is not named either.
    expect(posts).toEqual([
      { id: POST_A, title: "Live title" },
      { id: POST_B, title: "Untitled post" },
      { id: POST_C, title: "Seen today" },
    ]);

    expect(calls.map((call) => call.table)).toEqual(["daily_stats", "events", "content_entries"]);
    const [stats, events, entries] = calls as [Call, Call, Call];
    // The site's own rows, page-level, of the range only.
    expect(stats.filters).toContainEqual(["eq", "page_id", SITE]);
    expect(stats.filters).toContainEqual(["eq", "block_id", ""]);
    expect(stats.filters).toContainEqual(["gte", "day", "2026-09-01"]);
    expect(stats.filters).toContainEqual(["gt", "views", 0]);
    expect(events.filters).toContainEqual(["eq", "page_id", SITE]);
    expect(events.filters).toContainEqual(["eq", "type", "view"]);
    expect(events.filters).toContainEqual(["gte", "ts", "2026-09-01T00:00:00.000Z"]);
    // Published only, this site's posts only: the draft column is never named.
    expect(entries.select).toBe("id, title:published->>title");
    expect(entries.filters).toContainEqual(["eq", "site_id", SITE]);
    expect(entries.filters).toContainEqual(["in", "type_id", [POST_TYPE]]);
    expect(entries.filters).toContainEqual(["is", "deleted_at", null]);
    expect(entries.filters).toContainEqual(["not", "published", ["is", null]]);
    // A page of the site and the archive are never asked for as posts.
    const asked = entries.filters.find(([op, column]) => op === "in" && column === "id")![2];
    expect(asked).not.toContain(PAGE_ID);
    expect(asked).not.toContain(POST_TYPE);
  });

  it("a selected post is named even with no view in the range; a foreign or trashed id is not", async () => {
    const { db } = fakeDb({ content_entries: [{ id: POST_D, title: "Quiet post" }] });
    const input = { typeIds: [POST_TYPE], fromDay: "2026-09-01", listed: new Set<string>() };
    expect(await readViewedPosts(db, SITE, { ...input, selected: POST_D })).toEqual([
      { id: POST_D, title: "Quiet post" },
    ]);
    expect(await readViewedPosts(db, SITE, { ...input, selected: GONE })).toEqual([]);
    expect(await readViewedPosts(db, SITE, { ...input, selected: "home" })).toEqual([]);
  });

  it("names at most 50 posts and reads no stats row when the blog is off", async () => {
    const ids = Array.from({ length: 70 }, (_, i) => uuid(2000 + i));
    const { db } = fakeDb({
      daily_stats: ids.map((id, i) => ({ sub_page_id: id, views: 100 - i })),
      content_entries: ids.map((id) => ({ id, title: `Post ${id.slice(-4)}` })),
    });
    const posts = await readViewedPosts(db, SITE, {
      typeIds: [POST_TYPE],
      fromDay: "2026-09-01",
      listed: new Set(),
      selected: "all",
    });
    expect(posts).toHaveLength(50);
    expect(posts[0]!.id).toBe(ids[0]);
    expect(posts[49]!.id).toBe(ids[49]);

    const off = fakeDb({ daily_stats: [{ sub_page_id: POST_A, views: 3 }] });
    expect(
      await readViewedPosts(off.db, SITE, {
        typeIds: [],
        fromDay: "2026-09-01",
        listed: new Set(),
        selected: POST_A,
      }),
    ).toEqual([]);
    expect(off.calls).toEqual([]);
  });

  it("an archive that is off lists nothing and reads no post, but its type id is known", async () => {
    const { db, calls } = fakeDb({ content_types: [{ ...postType, enabled: false }] });
    expect(await readBlogPages(db, SITE)).toEqual({
      archives: [],
      typeIds: [POST_TYPE],
      enabledTypeIds: [],
    });
    expect(calls.map((call) => call.table)).toEqual(["content_types"]);
  });

  it("hides an existing post that is not listed and an archive that is off; a gone id stays", async () => {
    const { db, calls } = fakeDb({ content_entries: [{ id: POST_A }] });
    const hidden = await hiddenHistoryIds(db, SITE, [POST_TYPE, POST_A, GONE], [POST_TYPE]);
    expect([...hidden].sort()).toEqual([POST_TYPE, POST_A].sort());
    expect(calls).toHaveLength(1);
    const read = calls[0]!;
    expect(read.select).toBe("id");
    expect(read.filters).toContainEqual(["eq", "site_id", SITE]);
    expect(read.filters).toContainEqual(["in", "type_id", [POST_TYPE]]);
    expect(read.filters).toContainEqual(["is", "deleted_at", null]);
    // The type id itself is never asked for as a post.
    expect(read.filters).toContainEqual(["in", "id", [POST_A, GONE]]);
  });

  it("reads nothing when there is nothing to check or the site has no archive type", async () => {
    const none = fakeDb({});
    expect((await hiddenHistoryIds(none.db, SITE, [], [POST_TYPE])).size).toBe(0);
    expect((await hiddenHistoryIds(none.db, SITE, [GONE], [])).size).toBe(0);
    expect(none.calls).toEqual([]);
  });

  it("checks at most 200 ids, in reads of 100, and hides the ids past that unchecked", async () => {
    const ids = Array.from({ length: 260 }, (_, i) => uuid(1000 + i));
    const { db, calls } = fakeDb({ content_entries: [{ id: ids[0] }] });
    const hidden = await hiddenHistoryIds(db, SITE, ids, [POST_TYPE]);
    expect(POST_LOOKUP_MAX).toBe(200);
    expect(calls).toHaveLength(2);
    for (const read of calls) {
      const asked = read.filters.find(([op, column]) => op === "in" && column === "id")![2];
      expect(asked).toHaveLength(100);
    }
    expect(hidden.size).toBe(61);
    expect(hidden.has(ids[0]!)).toBe(true);
    expect(hidden.has(ids[1]!)).toBe(false);
    expect(hidden.has(ids[259]!)).toBe(true);
  });

  it("a failing read throws (the screen says it could not load), never an empty list", async () => {
    const db = {
      from: () => {
        const builder: Record<string, unknown> = {};
        for (const op of [
          "select",
          "eq",
          "neq",
          "not",
          "order",
          "in",
          "is",
          "gte",
          "gt",
          "limit",
        ]) {
          builder[op] = () => builder;
        }
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
        return builder;
      },
    } as unknown as SupabaseClient;
    await expect(readBlogPages(db, SITE)).rejects.toThrow("boom");
    await expect(hiddenHistoryIds(db, SITE, [GONE], [POST_TYPE])).rejects.toThrow("boom");
    await expect(
      readViewedPosts(db, SITE, {
        typeIds: [POST_TYPE],
        fromDay: "2026-09-01",
        listed: new Set(),
        selected: "all",
      }),
    ).rejects.toThrow("boom");
  });
});
