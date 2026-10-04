import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const updateTag = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag, revalidateTag, unstable_cache: vi.fn() }));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const cookieStore = { get: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

let pages: { id: string; handle: string; created_at: string }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: async () => ({ data: pages, error: null }) }),
      }),
    }),
    auth: { signOut: async () => ({ error: null }) },
  }),
}));

const isAccountSuspended = vi.fn();
vi.mock("@/lib/admin/suspension", () => ({ isAccountSuspended }));

const deleteUser = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({ auth: { admin: { deleteUser } } }),
}));

// M4-34: the steps that run before the delete (billing, Vercel domains, uploaded images) have their
// own tests (billing-delete-account.test.ts); here they are no-ops.
const cancelBilling_ = vi.fn(async () => 0);
vi.mock("@/lib/billing/cancel", () => ({ cancelAccountBilling: cancelBilling_ }));
vi.mock("@/lib/pages/delete-domains", () => ({ removeAccountDomains: async () => [] }));
vi.mock("@/lib/pages/delete-media", () => ({ removeAccountMedia: async () => undefined }));

const { deleteAccount } = await import("@/lib/pages/delete-account");

const PAGE_A = "00000000-0000-4000-8000-0000000000a1";
const PAGE_B = "00000000-0000-4000-8000-0000000000a2";

function form(confirm: string): FormData {
  const data = new FormData();
  data.set("confirm", confirm);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ id: "user-1" });
  isAccountSuspended.mockResolvedValue(false);
  cookieStore.get.mockReturnValue(undefined);
  deleteUser.mockResolvedValue({ error: null });
  pages = [
    { id: PAGE_A, handle: "mara", created_at: "2026-01-01T00:00:00Z" },
    { id: PAGE_B, handle: "mara-two", created_at: "2026-02-01T00:00:00Z" },
  ];
});

describe("M1-22 / M2-26 deleting an account expires the cache for each of its pages", () => {
  it("updateTag(pageTag) and the handle's cached 404 for every page, after the user is deleted", async () => {
    const order: string[] = [];
    deleteUser.mockImplementation(async () => {
      order.push("deleteUser");
      return { error: null };
    });
    updateTag.mockImplementation(() => order.push("updateTag"));
    revalidateTag.mockImplementation(() => order.push("revalidateTag"));

    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });

    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(updateTag.mock.calls).toEqual([[`page:${PAGE_A}`], [`page:${PAGE_B}`]]);
    expect(revalidateTag.mock.calls).toEqual([
      ["handle:mara", { expire: 0 }],
      ["handle:mara-two", { expire: 0 }],
    ]);
    // Never before the delete: a request in between could regenerate the page and keep it.
    expect(order[0]).toBe("deleteUser");
  });

  it("a wrong confirmation or a failed delete expires nothing", async () => {
    await expect(deleteAccount(null, form("nope"))).resolves.toEqual({
      error: expect.stringContaining("doesn’t match"),
    });
    expect(deleteUser).not.toHaveBeenCalled();

    deleteUser.mockResolvedValue({ error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: expect.stringContaining("couldn’t delete"),
    });
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("a cache failure after the delete does not turn the deletion into an error", async () => {
    updateTag.mockImplementation(() => {
      throw new Error("cache unavailable");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
  });
});

const cancelBilling = cancelBilling_;
describe("M5-09 a suspended account cannot be deleted", () => {
  it("is refused before anything else runs: no delete, no cache expiry, and the answer says why", async () => {
    isAccountSuspended.mockResolvedValue(true);
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "Your account is suspended, so it can’t be deleted. Contact support to appeal.",
    });
    expect(isAccountSuspended).toHaveBeenCalledWith("user-1");
    expect(deleteUser).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(cancelBilling).not.toHaveBeenCalled();
  });

  it("fails closed: an account that cannot be read is not deleted either", async () => {
    isAccountSuspended.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t check your account. Try again.",
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("unsuspended, the same call goes through", async () => {
    isAccountSuspended.mockResolvedValue(false);
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });
});
