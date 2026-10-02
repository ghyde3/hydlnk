import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag, updateTag: vi.fn(), unstable_cache: vi.fn() }));

const claimHandleWithClient = vi.fn();
vi.mock("@/lib/handles/claim-core", () => ({ claimHandleWithClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

const { claimHandle } = await import("@/lib/handles/claim");

beforeEach(() => vi.clearAllMocks());

describe("M2-26 claiming a handle drops its cached 404", () => {
  it("expires the handle's tag after a successful claim, so the placeholder shows at once", async () => {
    claimHandleWithClient.mockResolvedValue({ ok: true, handle: "newbie", pageId: "p1" });
    await expect(claimHandle("user-1", "Newbie")).resolves.toMatchObject({ ok: true });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("handle:newbie", { expire: 0 });
  });

  it("a cache failure after the claim does not turn the claim into a failure", async () => {
    claimHandleWithClient.mockResolvedValue({ ok: true, handle: "newbie", pageId: "p1" });
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(claimHandle("user-1", "newbie")).resolves.toMatchObject({ ok: true });
  });

  it("a refused claim invalidates nothing", async () => {
    claimHandleWithClient.mockResolvedValue({ ok: false, error: "taken" });
    await expect(claimHandle("user-1", "mara")).resolves.toEqual({ ok: false, error: "taken" });
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
