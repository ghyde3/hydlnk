import { describe, expect, it, vi } from "vitest";
import { emptySubPageDraft } from "@/lib/document";
import { SubPageSaver, type SubSaveResult } from "@/lib/site-pages/saver";

const doc = emptySubPageDraft("items", "Items");

/**
 * 1b1-17: the revision is the page entry's rev. The save-client side (the route's answers, the rev
 * kept after a save) is covered in m15-editor-save-entries.test.ts; this file keeps the queue's
 * behaviour on a conflict.
 */

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
