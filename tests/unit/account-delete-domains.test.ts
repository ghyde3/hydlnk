import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-34 step 1, the Vercel half of an account deletion: `removeAccountDomains` takes every custom
 * domain of the account's own pages off the Vercel project, one request per hostname, and the first
 * failure throws so the caller stops before the user is deleted. The database and the Vercel client
 * are replaced; the real stub is exercised in tests/e2e/m4/domains-vercel.spec.ts and
 * tests/e2e/m4/lifecycle-delete.spec.ts.
 */

vi.mock("server-only", () => ({}));

const inQuery = vi.fn();
const select = vi.fn<(columns: string) => { in: typeof inQuery }>();
const from = vi.fn<(table: string) => { select: typeof select }>();
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({ from }) }));

const removeProjectDomain = vi.fn<(hostname: string) => Promise<void>>();
vi.mock("@/lib/domains/vercel", () => ({ removeProjectDomain }));

const { removeAccountDomains } = await import("@/lib/pages/delete-domains");

const PAGES = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];

beforeEach(() => {
  vi.resetAllMocks();
  from.mockImplementation(() => ({ select }));
  select.mockImplementation(() => ({ in: inQuery }));
  removeProjectDomain.mockResolvedValue(undefined);
});

describe("M4-34 removeAccountDomains", () => {
  it("an account with no pages asks nobody anything", async () => {
    await removeAccountDomains([]);
    expect(from).not.toHaveBeenCalled();
    expect(removeProjectDomain).not.toHaveBeenCalled();
  });

  it("an account whose pages have no domains makes no Vercel request", async () => {
    inQuery.mockResolvedValue({ data: [], error: null });
    await removeAccountDomains(PAGES);
    expect(from).toHaveBeenCalledWith("domains");
    expect(inQuery).toHaveBeenCalledWith("page_id", PAGES);
    expect(removeProjectDomain).not.toHaveBeenCalled();
  });

  it("lists the domains of exactly the pages it is given and removes each hostname once, in order", async () => {
    inQuery.mockResolvedValue({
      data: [{ hostname: "one.example.com" }, { hostname: "two.example.com" }],
      error: null,
    });
    await removeAccountDomains(PAGES);
    expect(select).toHaveBeenCalledWith("hostname");
    expect(inQuery).toHaveBeenCalledWith("page_id", PAGES);
    expect(removeProjectDomain.mock.calls.map(([host]) => host)).toEqual([
      "one.example.com",
      "two.example.com",
    ]);
  });

  it("the first failure throws and no later hostname is attempted", async () => {
    inQuery.mockResolvedValue({
      data: [
        { hostname: "a.example.com" },
        { hostname: "b.example.com" },
        { hostname: "c.example.com" },
      ],
      error: null,
    });
    removeProjectDomain
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Vercel refused to remove b.example.com: HTTP 500"));
    await expect(removeAccountDomains(PAGES)).rejects.toThrow("HTTP 500");
    expect(removeProjectDomain.mock.calls.map(([host]) => host)).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
  });

  it("a Vercel API that is not configured fails closed instead of skipping the domain", async () => {
    inQuery.mockResolvedValue({ data: [{ hostname: "a.example.com" }], error: null });
    removeProjectDomain.mockRejectedValueOnce(
      new Error("Vercel is not configured: VERCEL_API_TOKEN is not set."),
    );
    await expect(removeAccountDomains(PAGES)).rejects.toThrow("not configured");
  });

  it("a failed listing throws instead of being read as 'no domains'", async () => {
    inQuery.mockResolvedValue({ data: null, error: { message: "db down" } });
    await expect(removeAccountDomains(PAGES)).rejects.toThrow(
      "Listing the account's domains failed: db down",
    );
    expect(removeProjectDomain).not.toHaveBeenCalled();
  });

  it("a retry removes every hostname again (removal is idempotent at Vercel, a missing one counts as removed)", async () => {
    inQuery.mockResolvedValue({
      data: [{ hostname: "a.example.com" }, { hostname: "b.example.com" }],
      error: null,
    });
    removeProjectDomain.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("blip"));
    await expect(removeAccountDomains(PAGES)).rejects.toThrow("blip");
    removeProjectDomain.mockClear();
    await removeAccountDomains(PAGES);
    expect(removeProjectDomain.mock.calls.map(([host]) => host)).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
  });
});
