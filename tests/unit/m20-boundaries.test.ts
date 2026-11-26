import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { sweepBlockBoundaries } = await import("@/lib/schedule/boundaries");

/**
 * M20-04: the boundary sweep sets the clock (in `due_block_boundaries`), expires each site, and only
 * then acknowledges it; a site whose expiry threw is not acknowledged, so the next tick expires it
 * again. A spy database records the order of the calls.
 */

function spyDb(due: string[][]) {
  const calls: Array<[string, unknown]> = [];
  let tick = 0;
  const db = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.push([name, args]);
      if (name === "due_block_boundaries") return { data: due[tick++] ?? [], error: null };
      return { data: 1, error: null };
    }),
  };
  return { db: db as never, calls };
}

describe("M20-04 sweepBlockBoundaries", () => {
  it("M20-04 expires each due site, then acknowledges exactly those", async () => {
    const { db, calls } = spyDb([["site-a", "site-b"]]);
    const order: string[] = [];
    const invalidate = vi.fn((siteId: string) => {
      order.push(`expire:${siteId}`);
      calls.push(["invalidate", siteId]);
    });
    const out = await sweepBlockBoundaries({ db, invalidate });
    expect(out).toEqual({ sites: 2, failed: 0 });
    expect(calls.map(([name]) => name)).toEqual([
      "due_block_boundaries",
      "invalidate",
      "invalidate",
      "advance_block_boundaries",
    ]);
    expect(calls[3]![1]).toEqual({ p_sites: ["site-a", "site-b"] });
  });

  it("M20-04 an expiry that throws is not acknowledged and is expired again on the next call", async () => {
    const { db, calls } = spyDb([["site-a", "site-b"], ["site-b"]]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let broken = true;
    const invalidate = vi.fn((siteId: string) => {
      if (siteId === "site-b" && broken) throw new Error("cache down");
    });
    expect(await sweepBlockBoundaries({ db, invalidate })).toEqual({ sites: 1, failed: 1 });
    expect(calls.find(([name]) => name === "advance_block_boundaries")![1]).toEqual({
      p_sites: ["site-a"],
    });
    broken = false;
    calls.length = 0;
    expect(await sweepBlockBoundaries({ db, invalidate })).toEqual({ sites: 1, failed: 0 });
    expect(invalidate).toHaveBeenLastCalledWith("site-b");
    expect(calls.at(-1)).toEqual(["advance_block_boundaries", { p_sites: ["site-b"] }]);
  });

  it("M20-04 nothing due: no expiry and no acknowledgement", async () => {
    const { db, calls } = spyDb([[]]);
    const invalidate = vi.fn();
    expect(await sweepBlockBoundaries({ db, invalidate })).toEqual({ sites: 0, failed: 0 });
    expect(invalidate).not.toHaveBeenCalled();
    expect(calls.map(([name]) => name)).toEqual(["due_block_boundaries"]);
  });

  it("M20-04 a database error throws (the route answers 500, nothing is acknowledged)", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "down" } }) } as never;
    await expect(sweepBlockBoundaries({ db, invalidate: vi.fn() })).rejects.toThrow(/down/);
  });
});
