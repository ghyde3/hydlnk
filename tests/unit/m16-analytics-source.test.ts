// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

import {
  POST_LOOKUP_MAX,
  hiddenHistoryIds,
  readBlogPages,
} from "@/lib/analytics/dashboard/source";

/**
 * M16-11: the blog's entries of the Analytics page filter. Every read is keyed by the site the
 * owner lookup approved; only published titles are selected (never a draft or a body); a trashed
 * post is not asked for; no stats table is read here (a refused range must read none).
 */

const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const SITE = uuid(1);
const POST_TYPE = uuid(3);
const POST_A = uuid(4);
const POST_B = uuid(5);
const GONE = uuid(6);

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
      for (const op of ["eq", "neq", "in", "is", "not"]) {
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
          (row) => !Array.isArray(ids) || ids.includes(row.id as string),
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
  it("lists the archive as Blog and the newest live posts by their published title", async () => {
    const { db, calls } = fakeDb({
      content_types: [postType],
      content_entries: [
        { id: POST_A.toUpperCase(), title: "Live title" },
        { id: POST_B, title: null },
      ],
    });
    expect(await readBlogPages(db, SITE)).toEqual({
      archives: [{ id: POST_TYPE, title: "Blog" }],
      posts: [
        { id: POST_A, title: "Live title" },
        { id: POST_B, title: "Untitled post" },
      ],
      typeIds: [POST_TYPE],
    });

    expect(calls.map((call) => call.table)).toEqual(["content_types", "content_entries"]);
    for (const call of calls) expect(call.filters).toContainEqual(["eq", "site_id", SITE]);
    expect(calls[0]!.filters).toContainEqual(["neq", "key", "page"]);
    const posts = calls[1]!;
    // Published only: the draft column is never named.
    expect(posts.select).toBe("id, title:published->>title");
    expect(posts.select).not.toContain("draft");
    expect(posts.filters).toContainEqual(["in", "type_id", [POST_TYPE]]);
    expect(posts.filters).toContainEqual(["is", "deleted_at", null]);
    expect(posts.filters).toContainEqual(["not", "published", ["is", null]]);
    expect(posts.limit).toBe(50);
  });

  it("an archive that is off lists nothing and reads no post, but its type id is known", async () => {
    const { db, calls } = fakeDb({ content_types: [{ ...postType, enabled: false }] });
    expect(await readBlogPages(db, SITE)).toEqual({ archives: [], posts: [], typeIds: [POST_TYPE] });
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
        for (const op of ["select", "eq", "neq", "not", "order", "in", "is"]) {
          builder[op] = () => builder;
        }
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
        return builder;
      },
    } as unknown as SupabaseClient;
    await expect(readBlogPages(db, SITE)).rejects.toThrow("boom");
    await expect(hiddenHistoryIds(db, SITE, [GONE], [POST_TYPE])).rejects.toThrow("boom");
  });
});
