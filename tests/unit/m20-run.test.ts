import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wave E review fixes: one tick of the schedule route (`runSchedules`). The boundary sweep and the
 * worker run side by side and report on their own (a failing sweep never holds back the scheduled
 * publishes, M20-04 / M20-08); a scheduled page publish ends with the hand publish's own step
 * (`afterPagePublished`: the site's tag, then the owner's media queue, M20-08 step 2).
 */

vi.mock("server-only", () => ({}));
const db = { tag: "admin-client" };
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => db }));
const sweep = vi.hoisted(() => vi.fn());
vi.mock("@/lib/schedule/boundaries", () => ({ sweepBlockBoundaries: sweep }));
const worker = vi.hoisted(() => vi.fn());
vi.mock("@/lib/schedule/worker", () => ({ runScheduleWorker: worker }));
const expireTagsNow = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/publish/invalidate", async () => ({
  ...(await vi.importActual<object>("@/lib/publish/invalidate")),
  expireTagsNow,
}));
const cleanupMediaQuietly = vi.hoisted(() => vi.fn(async () => null));
vi.mock("@/lib/media/cleanup-admin", () => ({ cleanupMediaQuietly }));
vi.mock("@/lib/content", () => ({
  publishEntryWithClient: vi.fn(),
  unpublishEntryWithClient: vi.fn(),
}));
vi.mock("@/lib/publish/core", () => ({ publishSitePageCore: vi.fn() }));
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: vi.fn(),
}));

const { runSchedules } = await import("@/lib/schedule/run");

const COUNTS = { published: 3, unpublished: 0, failed: 0, retried: 0, expiryFailed: 0 };
const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  claim: "c",
  action: "publish",
  entryId: "e1",
  siteId: "S1",
  ownerId: "owner-1",
  createdBy: "owner-1",
  typeId: "t1",
  typeKey: "page",
  runAt: "2026-12-01T09:00:00Z",
  snapshot: {},
  attempts: 1,
  ...over,
});

beforeEach(() => {
  sweep.mockReset();
  worker.mockReset();
  expireTagsNow.mockClear();
  cleanupMediaQuietly.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("runSchedules: two halves, each on its own", () => {
  it("M20-04 a failing boundary sweep does not stop the worker: both ran, the sweep is reported", async () => {
    sweep.mockRejectedValueOnce(new Error("due_block_boundaries down"));
    worker.mockResolvedValueOnce(COUNTS);
    const out = await runSchedules();
    expect(worker).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ...COUNTS, sites: 0, sweepFailed: true, workerFailed: false });
  });

  it("M20-08 a failing worker does not stop the sweep", async () => {
    sweep.mockResolvedValueOnce({ sites: 2, failed: 0 });
    worker.mockRejectedValueOnce(new Error("claim down"));
    const out = await runSchedules();
    expect(sweep).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ sites: 2, published: 0, sweepFailed: false, workerFailed: true });
  });

  it("M20-08 neither waits for the other: the worker starts while the sweep is still running", async () => {
    let finishSweep!: (value: unknown) => void;
    sweep.mockReturnValueOnce(new Promise((resolve) => (finishSweep = resolve)));
    worker.mockResolvedValueOnce(COUNTS);
    const tick = runSchedules();
    await Promise.resolve();
    expect(worker).toHaveBeenCalledTimes(1);
    finishSweep({ sites: 0, failed: 0 });
    expect(await tick).toMatchObject({ sweepFailed: false, workerFailed: false });
  });

  it("M20-04 the sweep's expiry is the awaited one, on the site's tag", async () => {
    sweep.mockResolvedValueOnce({ sites: 0, failed: 0 });
    worker.mockResolvedValueOnce(COUNTS);
    await runSchedules();
    const { invalidate } = sweep.mock.calls[0]![0] as { invalidate: (id: string) => Promise<void> };
    await invalidate("s1");
    expect(expireTagsNow).toHaveBeenCalledWith(["page:s1"]);
  });
});

describe("a fire's cache expiry", () => {
  async function expireOf() {
    sweep.mockResolvedValueOnce({ sites: 0, failed: 0 });
    worker.mockResolvedValueOnce(COUNTS);
    await runSchedules();
    return (worker.mock.calls[0]![0] as { expire: (r: unknown, p: unknown) => Promise<boolean> })
      .expire;
  }

  it("M20-08 a scheduled page publish takes the hand publish's step: the site's tag, then the media queue", async () => {
    const expire = await expireOf();
    expect(await expire(row(), { siteId: "S1", typeId: "t1", typeKey: "page" })).toBe(true);
    expect(expireTagsNow).toHaveBeenCalledWith(["page:s1"]);
    expect(cleanupMediaQuietly).toHaveBeenCalledWith("owner-1", db);
    expect(expireTagsNow.mock.invocationCallOrder[0]!).toBeLessThan(
      cleanupMediaQuietly.mock.invocationCallOrder[0]!,
    );
  });

  it("M20-08 a post expires its own tags and its type's, with no media cleanup", async () => {
    const expire = await expireOf();
    expect(
      await expire(row({ typeKey: "post" }), { siteId: "S1", typeId: "t1", typeKey: "post" }),
    ).toBe(true);
    expect(expireTagsNow).toHaveBeenCalledWith(["entry:e1", "type:t1"]);
    expect(cleanupMediaQuietly).not.toHaveBeenCalled();
  });

  it("M20-08 an expiry that fails twice answers false and skips the cleanup", async () => {
    const expire = await expireOf();
    expireTagsNow.mockRejectedValueOnce(new Error("a")).mockRejectedValueOnce(new Error("b"));
    expect(await expire(row(), { siteId: "S1", typeId: "t1", typeKey: "page" })).toBe(false);
    expect(cleanupMediaQuietly).not.toHaveBeenCalled();
  });
});
