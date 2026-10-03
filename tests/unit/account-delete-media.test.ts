import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-34 step 1, the Storage half of an account deletion: `removeAccountMedia` removes every object
 * under `{uid}/` in the `page-media` bucket and nothing else, and throws when Storage fails so the
 * caller stops before the user is deleted. Storage is replaced here; the real bucket is exercised in
 * tests/e2e/m4/billing-delete.spec.ts and tests/e2e/m4/lifecycle-delete.spec.ts.
 */

vi.mock("server-only", () => ({}));

const list = vi.fn();
const remove = vi.fn();
const from = vi.fn(() => ({ list, remove }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({ storage: { from } }),
}));

const { removeAccountMedia } = await import("@/lib/pages/delete-media");

const UID = "11111111-1111-4111-8111-111111111111";
const file = (name: string) => ({ name, id: `id-${name}` });
const folder = (name: string) => ({ name, id: null });
const files = (count: number, prefix = "f") =>
  Array.from({ length: count }, (_, i) => file(`${prefix}${i}.webp`));

beforeEach(() => {
  vi.resetAllMocks();
  from.mockImplementation(() => ({ list, remove }));
  remove.mockResolvedValue({ error: null });
});

describe("M4-34 removeAccountMedia", () => {
  it("works only in the page-media bucket and removes the user's files with their folder prefix", async () => {
    list.mockResolvedValue({ data: [file("a.webp"), file("b.webp")], error: null });
    await removeAccountMedia(UID);
    expect(from).toHaveBeenCalledWith("page-media");
    expect(list).toHaveBeenCalledWith(UID, { limit: 1000, offset: 0 });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([`${UID}/a.webp`, `${UID}/b.webp`]);
  });

  it("an account with no uploads calls remove never", async () => {
    list.mockResolvedValue({ data: [], error: null });
    await removeAccountMedia(UID);
    expect(remove).not.toHaveBeenCalled();
  });

  it("walks sub-folders and lists each one under the user's prefix only", async () => {
    list.mockImplementation(async (prefix: string) => {
      if (prefix === UID) return { data: [file("a.webp"), folder("old")], error: null };
      if (prefix === `${UID}/old`) return { data: [file("b.webp"), folder("deeper")], error: null };
      if (prefix === `${UID}/old/deeper`) return { data: [file("c.webp")], error: null };
      return { data: [], error: null };
    });
    await removeAccountMedia(UID);
    expect(list.mock.calls.map(([prefix]) => prefix).sort()).toEqual(
      [UID, `${UID}/old`, `${UID}/old/deeper`].sort(),
    );
    expect(remove).toHaveBeenCalledWith([
      `${UID}/a.webp`,
      `${UID}/old/b.webp`,
      `${UID}/old/deeper/c.webp`,
    ]);
    for (const [prefix] of list.mock.calls) expect(String(prefix).startsWith(UID)).toBe(true);
  });

  it("pages through a listing of more than 1000 objects and removes in chunks of 100", async () => {
    list
      .mockResolvedValueOnce({ data: files(1000, "p1-"), error: null })
      .mockResolvedValueOnce({ data: files(250, "p2-"), error: null });
    await removeAccountMedia(UID);
    expect(list.mock.calls.map(([, options]) => options)).toEqual([
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 1000 },
    ]);
    const chunks = remove.mock.calls.map(([paths]) => (paths as string[]).length);
    expect(chunks).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 50]);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(1250);
  });

  it("a failed listing throws and removes nothing", async () => {
    list.mockResolvedValue({ data: null, error: { message: "storage is down" } });
    await expect(removeAccountMedia(UID)).rejects.toThrow(
      "Listing page-media failed: storage is down",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("a failed listing of a sub-folder throws before anything is removed", async () => {
    list.mockImplementation(async (prefix: string) =>
      prefix === UID
        ? { data: [file("a.webp"), folder("old")], error: null }
        : { data: null, error: { message: "nope" } },
    );
    await expect(removeAccountMedia(UID)).rejects.toThrow("Listing page-media failed: nope");
    expect(remove).not.toHaveBeenCalled();
  });

  it("a failed remove throws and stops at that chunk", async () => {
    list.mockResolvedValue({ data: files(250), error: null });
    remove
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "denied" } });
    await expect(removeAccountMedia(UID)).rejects.toThrow(
      "Removing from page-media failed: denied",
    );
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("a retry after a partial failure only has to list what is left", async () => {
    list.mockResolvedValueOnce({ data: files(150), error: null });
    remove
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "blip" } });
    await expect(removeAccountMedia(UID)).rejects.toThrow("blip");
    // The 100 already removed are gone from the next listing.
    list.mockResolvedValueOnce({ data: files(50, "left-"), error: null });
    await removeAccountMedia(UID);
    const last = remove.mock.calls.at(-1)![0] as string[];
    expect(last).toHaveLength(50);
    expect(last.every((path) => path.startsWith(`${UID}/left-`))).toBe(true);
  });
});
