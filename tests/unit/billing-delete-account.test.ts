import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M4-34: deleting an account cancels billing first, then removes custom domains, then uploaded
 * images, and only then deletes the user. A failure at any step stops the deletion with the
 * message for that step. The Server Action is exercised with every collaborator mocked; the
 * Stripe and Storage calls themselves are covered over HTTP in tests/e2e/m4/billing-delete.spec.ts.
 */

vi.mock("server-only", () => ({}));
// M10-19: disconnecting the connected apps is the first step of a deletion; its own tests are in
// m10-oauth-delete-account.test.ts, here it is a no-op.
vi.mock("@/lib/oauth/grants", () => ({ revokeAllGrants: async () => 0 }));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn(),
}));

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

const pages = [
  { id: "00000000-0000-4000-8000-0000000000a1", handle: "mara", created_at: "2026-01-01" },
];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: pages, error: null }) }) }),
    }),
    auth: { signOut: async () => ({ error: null }) },
  }),
}));

const order: string[] = [];
const deleteUser = vi.fn<(id: string) => Promise<{ error: null }>>(async () => {
  order.push("deleteUser");
  return { error: null };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({ auth: { admin: { deleteUser } } }),
}));

// M5-09: a suspended account cannot be deleted; this file is about the order of the steps of an
// ordinary deletion (the suspended case is in delete-account-cache.test.ts).
vi.mock("@/lib/admin/suspension", () => ({ isAccountSuspended: async () => false }));

const cancelAccountBilling = vi.fn<(id: string) => Promise<number>>(async () => {
  order.push("billing");
  return 1;
});
// It returns the hostnames it took off the project (M8-11: the caller expires the proxy's lookup of each).
const removeAccountDomains = vi.fn<(ids: readonly string[]) => Promise<string[]>>(async () => {
  order.push("domains");
  return [];
});
const removeAccountMedia = vi.fn<(id: string) => Promise<void>>(async () => {
  order.push("media");
});
vi.mock("@/lib/billing/cancel", () => ({ cancelAccountBilling }));
vi.mock("@/lib/pages/delete-domains", () => ({ removeAccountDomains }));
vi.mock("@/lib/pages/delete-media", () => ({ removeAccountMedia }));

const { deleteAccount } = await import("@/lib/pages/delete-account");

const form = (confirm: string) => {
  const data = new FormData();
  data.set("confirm", confirm);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  getSessionUser.mockResolvedValue({ id: "user-1" });
  cookieStore.get.mockReturnValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("M4-34 the order of an account deletion", () => {
  it("cancels billing, removes domains, removes images, then deletes the user", async () => {
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(order).toEqual(["billing", "domains", "media", "deleteUser"]);
    expect(cancelAccountBilling).toHaveBeenCalledWith("user-1");
    expect(removeAccountMedia).toHaveBeenCalledWith("user-1");
    expect(removeAccountDomains).toHaveBeenCalledWith([pages[0]!.id]);
  });

  it("a failed subscription cancel deletes nothing and says so", async () => {
    cancelAccountBilling.mockImplementationOnce(async () => {
      order.push("billing");
      throw new Error("stripe is down");
    });
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t cancel your subscription. Try again.",
    });
    expect(order).toEqual(["billing"]);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("a failed domain removal deletes nothing and says so", async () => {
    removeAccountDomains.mockImplementationOnce(async () => {
      order.push("domains");
      throw new Error("vercel is down");
    });
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t remove your custom domain. Try again.",
    });
    expect(order).toEqual(["billing", "domains"]);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("a failed image removal deletes nothing", async () => {
    removeAccountMedia.mockImplementationOnce(async () => {
      order.push("media");
      throw new Error("storage is down");
    });
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: expect.stringContaining("couldn’t remove your uploaded images"),
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("a retry after a failure runs every step again and finishes", async () => {
    cancelAccountBilling.mockImplementationOnce(async () => {
      order.push("billing");
      throw new Error("blip");
    });
    await deleteAccount(null, form("mara"));
    order.length = 0;
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(order).toEqual(["billing", "domains", "media", "deleteUser"]);
  });

  it("a wrong confirmation is refused before any step runs", async () => {
    await expect(deleteAccount(null, form("nope"))).resolves.toEqual({
      error: expect.stringContaining("doesn’t match"),
    });
    expect(order).toEqual([]);
  });

  it("without a session it goes to /login and no step runs", async () => {
    getSessionUser.mockResolvedValue(null);
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({ to: "/login" });
    expect(order).toEqual([]);
  });

  it("the target is the session user, whatever the form says", async () => {
    const data = form("mara");
    data.set("userId", "someone-else");
    data.set("customer", "cus_someone_else");
    await expect(deleteAccount(null, data)).rejects.toMatchObject({ to: "/login?deleted=1" });
    expect(cancelAccountBilling).toHaveBeenCalledWith("user-1");
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });
});
