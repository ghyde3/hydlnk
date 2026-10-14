// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Publish moves the rev of a page entry whose first system revision kept the original draft (a page
 * the mover rewrote), so the editor re-reads the revs of its pages after Publish and Unpublish.
 * Without it the next save of that page sends a stale rev and answers `conflict`.
 */

let rows: { id: string; rev: number }[] = [];
const eq = vi.fn(async () => ({ data: rows, error: null }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock("@/lib/supabase/browser", () => ({ createBrowserSupabase: () => ({ from }) }));

describe("sub-page revisions after Publish", () => {
  it("refresh adopts the revs the database holds for the pages the editor knows", async () => {
    const { createSubPageRevisions } = await import("@/lib/site-pages/save-client");
    const revisions = createSubPageRevisions({ a: 1, b: 1 });
    rows = [
      { id: "a", rev: 2 },
      { id: "b", rev: 1 },
      { id: "other", rev: 9 },
    ];
    await revisions.refresh("site-1");
    expect(from).toHaveBeenCalledWith("content_entries");
    expect(eq).toHaveBeenCalledWith("site_id", "site-1");
    expect(revisions.get("a")).toBe(2);
    expect(revisions.get("b")).toBe(1);
    expect(revisions.get("other")).toBeUndefined();
  });

  it("a failed read leaves the revs as they were", async () => {
    const { createSubPageRevisions } = await import("@/lib/site-pages/save-client");
    const revisions = createSubPageRevisions({ a: 1 });
    eq.mockResolvedValueOnce({ data: null, error: { message: "down" } } as never);
    await revisions.refresh("site-1");
    expect(revisions.get("a")).toBe(1);
  });

  it("the editor re-reads the revs after markPublished and markUnpublished", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/site/use-site-pages.ts"), "utf8");
    for (const name of ["markPublished", "markUnpublished"]) {
      const start = src.indexOf(`const ${name} = useCallback`);
      const end = src.indexOf("}, [", start);
      expect(src.slice(start, end), name).toContain("revisions.refresh(siteId)");
    }
  });
});
