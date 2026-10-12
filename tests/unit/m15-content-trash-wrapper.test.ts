// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const invalidatePage = vi.hoisted(() => vi.fn());
const core = vi.hoisted(() => ({ trash: vi.fn(), restore: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/publish/invalidate", () => ({ invalidatePage }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));
vi.mock("@/lib/content/trash-core", () => ({
  trashEntryWithClient: core.trash,
  restoreEntryWithClient: core.restore,
}));

import { restoreEntry, trashEntry } from "@/lib/content";

const input = { actor: { userId: "u", source: "editor" as const }, entryId: "e", expectedRev: 1 };

describe("the trash and restore wrappers", () => {
  beforeEach(() => {
    invalidatePage.mockReset();
    core.trash.mockReset();
    core.restore.mockReset();
  });

  it("trashEntry expires the site tag on ok", async () => {
    core.trash.mockResolvedValueOnce({ ok: true, rev: 2, siteId: "s1" });
    await trashEntry(input);
    expect(invalidatePage).toHaveBeenCalledWith("s1");
  });

  it("restoreEntry expires the site tag on ok", async () => {
    core.restore.mockResolvedValueOnce({ ok: true, rev: 3, siteId: "s2" });
    await restoreEntry(input);
    expect(invalidatePage).toHaveBeenCalledWith("s2");
  });

  it("expires nothing after a refusal", async () => {
    core.trash.mockResolvedValueOnce({ ok: false, error: "conflict" });
    core.restore.mockResolvedValueOnce({ ok: false, error: "not_found" });
    await trashEntry(input);
    await restoreEntry(input);
    expect(invalidatePage).not.toHaveBeenCalled();
  });

  it("a failing expiry is only logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    invalidatePage.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    core.trash.mockResolvedValueOnce({ ok: true, rev: 2, siteId: "s1" });
    await expect(trashEntry(input)).resolves.toMatchObject({ ok: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
