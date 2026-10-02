import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const revalidateTag = vi.fn();
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag, updateTag, unstable_cache: vi.fn() }));

let rows: { id: string }[] = [];
let failure: { message: string } | null = null;
const filters: [string, unknown][] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    from(table: string) {
      expect(table).toBe("pages");
      return {
        select: (columns: string) => {
          expect(columns).toBe("id");
          return {
            eq: async (column: string, value: unknown) => {
              filters.push([column, value]);
              return failure ? { data: null, error: failure } : { data: rows, error: null };
            },
          };
        },
      };
    },
  }),
}));

const { expireDeletedPages, invalidateAccountPages, invalidateHandle } =
  await import("@/lib/publish/invalidate");
const { pageTag, handleTag } = await import("@/lib/publish/tags");

beforeEach(() => {
  revalidateTag.mockClear();
  updateTag.mockClear();
  filters.length = 0;
  rows = [];
  failure = null;
});

const ACCOUNT = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";

describe("M2-28 invalidateAccountPages(accountId)", () => {
  it("revalidates one tag per page of the account, with nothing stale served", async () => {
    rows = [
      { id: "00000000-0000-4000-8000-0000000000b1" },
      { id: "00000000-0000-4000-8000-0000000000b2" },
      { id: "00000000-0000-4000-8000-0000000000b3" },
    ];
    await expect(invalidateAccountPages(ACCOUNT)).resolves.toBe(3);
    expect(filters).toEqual([["owner_id", ACCOUNT]]);
    expect(revalidateTag).toHaveBeenCalledTimes(3);
    expect(revalidateTag.mock.calls).toEqual(rows.map((row) => [pageTag(row.id), { expire: 0 }]));
  });

  it("an account without pages revalidates nothing", async () => {
    await expect(invalidateAccountPages(ACCOUNT)).resolves.toBe(0);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("throws when the pages cannot be listed, so a webhook can fail and retry", async () => {
    failure = { message: "connection reset" };
    await expect(invalidateAccountPages(ACCOUNT)).rejects.toThrow(/connection reset/);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe("tags", () => {
  it("a page tag is built from the page id and a handle tag from the handle", () => {
    expect(pageTag("00000000-0000-4000-8000-0000000000b1")).toBe(
      "page:00000000-0000-4000-8000-0000000000b1",
    );
    expect(handleTag("mara")).toBe("handle:mara");
    expect(pageTag("a").length).toBeLessThan(256);
  });

  it("invalidateHandle expires the cached 404 of a handle at once", () => {
    invalidateHandle("mara");
    expect(revalidateTag).toHaveBeenCalledWith("handle:mara", { expire: 0 });
  });
});

describe("one page failing does not leave the others cached", () => {
  it("invalidateAccountPages tries every page, then raises the first failure", async () => {
    rows = [
      { id: "00000000-0000-4000-8000-0000000000b1" },
      { id: "00000000-0000-4000-8000-0000000000b2" },
      { id: "00000000-0000-4000-8000-0000000000b3" },
    ];
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("first page failed");
    });
    await expect(invalidateAccountPages(ACCOUNT)).rejects.toThrow("first page failed");
    expect(revalidateTag).toHaveBeenCalledTimes(3);
  });

  it("expireDeletedPages tries every page, then raises the first failure", () => {
    updateTag.mockImplementationOnce(() => {
      throw new Error("tag failed");
    });
    expect(() =>
      expireDeletedPages([
        { id: "00000000-0000-4000-8000-0000000000b1", handle: "a-one" },
        { id: "00000000-0000-4000-8000-0000000000b2", handle: "b-two" },
      ]),
    ).toThrow("tag failed");
    expect(updateTag).toHaveBeenCalledTimes(2);
  });
});

describe("expireDeletedPages (account deletion)", () => {
  it("expires each page's tag with updateTag and each handle's cached 404", () => {
    expireDeletedPages([
      { id: "00000000-0000-4000-8000-0000000000b1", handle: "mara" },
      { id: "00000000-0000-4000-8000-0000000000b2", handle: "mara-two" },
    ]);
    expect(updateTag.mock.calls).toEqual([
      [pageTag("00000000-0000-4000-8000-0000000000b1")],
      [pageTag("00000000-0000-4000-8000-0000000000b2")],
    ]);
    expect(revalidateTag.mock.calls).toEqual([
      [handleTag("mara"), { expire: 0 }],
      [handleTag("mara-two"), { expire: 0 }],
    ]);
  });

  it("an account without pages expires nothing", () => {
    expireDeletedPages([]);
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
