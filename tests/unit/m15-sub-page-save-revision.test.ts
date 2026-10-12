import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySubPageDraft } from "@/lib/document";
import { SubPageSaver, type SubSaveResult } from "@/lib/site-pages/saver";

/**
 * M15-01: a sub-page save is conditional on the revision the editor last loaded (`updated_at`, the
 * notion MCP's writer uses), so a change made elsewhere is never overwritten. A conditional update
 * that matches no row is a conflict, unless the row is gone (then it is "missing").
 */

const calls: Array<{ op: string; args: unknown[] }> = [];
let updateRows: Array<{ id: string; updated_at: string }> = [];
let existsRows: Array<{ id: string }> = [];
let updateError: { code?: string; message: string } | null = null;

vi.mock("@/lib/supabase/browser", () => ({
  createBrowserSupabase: () => ({
    from: (table: string) => {
      calls.push({ op: "from", args: [table] });
      let mode: "update" | "read" = "read";
      const chain: Record<string, unknown> = {
        update: (...args: unknown[]) => {
          mode = "update";
          calls.push({ op: "update", args });
          return chain;
        },
        select: (...args: unknown[]) => {
          calls.push({ op: "select", args });
          return chain;
        },
        eq: (...args: unknown[]) => {
          calls.push({ op: "eq", args });
          return chain;
        },
        then: (resolve: (value: unknown) => void) =>
          resolve(
            mode === "update"
              ? { data: updateError ? null : updateRows, error: updateError, status: 200 }
              : { data: existsRows, error: null, status: 200 },
          ),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/media/cleanup-client", () => ({ scheduleMediaCleanup: () => {} }));

import { createSubPageRevisions, createSubPageSaveFn } from "@/lib/site-pages/save-client";

const doc = emptySubPageDraft("items", "Items");
const REV_1 = "2026-10-11T10:00:00.123456+00:00";
const REV_2 = "2026-10-11T10:00:05.654321+00:00";

beforeEach(() => {
  calls.length = 0;
  updateRows = [];
  existsRows = [];
  updateError = null;
});

describe("createSubPageSaveFn (revision check)", () => {
  it("updates only where updated_at is the revision it loaded, and keeps the new one", async () => {
    updateRows = [{ id: "a", updated_at: REV_2 }];
    const revisions = createSubPageRevisions({ a: REV_1 });
    const save = createSubPageSaveFn(revisions);
    await expect(save("a", doc)).resolves.toEqual({ kind: "ok" });
    const eqs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["id", "a"]);
    expect(eqs).toContainEqual(["updated_at", REV_1]);
    expect(revisions.get("a")).toBe(REV_2);

    // The next save is guarded by the revision the last one returned.
    calls.length = 0;
    updateRows = [{ id: "a", updated_at: "2026-10-11T10:00:09+00:00" }];
    await save("a", doc);
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual([
      "updated_at",
      REV_2,
    ]);
  });

  it("zero rows matched while the row still exists is a conflict, and the revision is kept", async () => {
    updateRows = [];
    existsRows = [{ id: "a" }];
    const revisions = createSubPageRevisions({ a: REV_1 });
    await expect(createSubPageSaveFn(revisions)("a", doc)).resolves.toEqual({ kind: "conflict" });
    expect(revisions.get("a")).toBe(REV_1);
  });

  it("zero rows matched and the row is gone is missing", async () => {
    const revisions = createSubPageRevisions({ a: REV_1 });
    await expect(createSubPageSaveFn(revisions)("a", doc)).resolves.toEqual({ kind: "missing" });
  });

  it("a page with no known revision is never written unconditionally", async () => {
    const save = createSubPageSaveFn(createSubPageRevisions({}));
    await expect(save("a", doc)).resolves.toEqual({ kind: "conflict" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("keeps the other refusals", async () => {
    updateError = { code: "23514", message: "check" };
    const save = createSubPageSaveFn(createSubPageRevisions({ a: REV_1 }));
    await expect(save("a", doc)).resolves.toEqual({ kind: "too-large" });
  });
});

describe("SubPageSaver on a conflict", () => {
  it("stops saving, reports conflict, and writes nothing more", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (): Promise<SubSaveResult> => ({ kind: "conflict" }));
    const statuses: string[] = [];
    const saver = new SubPageSaver({ save, onStatus: (s) => statuses.push(s) });
    saver.schedule("a", doc);
    await vi.advanceTimersByTimeAsync(900);
    expect(statuses).toEqual(["pending", "saving", "conflict"]);
    saver.schedule("a", emptySubPageDraft("items", "Again"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    await expect(saver.flush()).resolves.toBe(false);
    expect(saver.hasUnsaved).toBe(true);
    saver.dispose();
    vi.useRealTimers();
  });
});
