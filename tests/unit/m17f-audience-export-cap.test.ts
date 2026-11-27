import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabase: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));
vi.mock("@/lib/site/page-entries-core", () => ({
  getPublishedHomeWithClient: async () => null,
  getHomeDraftWithClient: async () => null,
  listDraftPagesWithClient: async () => [],
}));

const { AUDIENCE_EXPORT_MAX_ROWS, AUDIENCE_EXPORT_PAGE_ROWS } = await import("@/lib/forms/export");
const { loadAudienceExportWithClient } = await import("@/lib/forms/audience");

/**
 * M17-09 step 2: the export holds at most the newest 50,000 rows. The cap is pinned, and the loader's
 * DEFAULT sizes use it: against a site with more submissions than that (a spy client that always
 * has a full page more), the loader with no sizes given stops at exactly 50,000 rows, newest first,
 * in pages of AUDIENCE_EXPORT_PAGE_ROWS.
 */

describe("M17-09 the export's row cap", () => {
  it("is 50,000", () => {
    expect(AUDIENCE_EXPORT_MAX_ROWS).toBe(50_000);
  });

  it("the loader's default stops at the cap, reading newest first in pages", async () => {
    const ranges: Array<[number, number]> = [];
    const orders: string[] = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: (column: string, opts: { ascending: boolean }) => {
        orders.push(`${column}:${opts.ascending ? "asc" : "desc"}`);
        return chain;
      },
      range: async (from: number, to: number) => {
        ranges.push([from, to]);
        // Always a full page: the site holds more rows than the cap.
        return {
          data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: String(from + i) })),
          error: null,
        };
      },
    };
    const client = { from: () => chain } as never;
    const out = await loadAudienceExportWithClient(client, { siteId: "s", form: "all" });
    expect(out.rows).toHaveLength(AUDIENCE_EXPORT_MAX_ROWS);
    expect(ranges).toHaveLength(AUDIENCE_EXPORT_MAX_ROWS / AUDIENCE_EXPORT_PAGE_ROWS);
    expect(ranges[0]).toEqual([0, AUDIENCE_EXPORT_PAGE_ROWS - 1]);
    expect(ranges.at(-1)).toEqual([
      AUDIENCE_EXPORT_MAX_ROWS - AUDIENCE_EXPORT_PAGE_ROWS,
      AUDIENCE_EXPORT_MAX_ROWS - 1,
    ]);
    expect(orders.slice(0, 2)).toEqual(["created_at:desc", "id:desc"]);
  });
});
