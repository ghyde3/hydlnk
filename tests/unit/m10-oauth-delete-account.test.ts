import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M10-19: deleting an account disconnects every connected app first: after the suspension check and
 * the handle confirmation, before the billing step. When it fails the dialog says so and nothing else
 * runs (the pattern of M4-34's three steps). The database side (nothing of the wave remains for the
 * user, the clients stay) is test 070 and tests/e2e/m10/oauth-delete.spec.ts.
 */

vi.mock("server-only", () => ({}));
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

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: [
              {
                id: "00000000-0000-4000-8000-0000000000a1",
                handle: "mara",
                created_at: "2026-10-01",
              },
            ],
            error: null,
          }),
        }),
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

const order: string[] = [];
const revokeAllGrants = vi.fn(async (userId: string) => {
  void userId;
  order.push("grants");
  return 0;
});
vi.mock("@/lib/oauth/grants", () => ({ revokeAllGrants }));
const cancelAccountBilling = vi.fn(async () => {
  order.push("billing");
  return 0;
});
vi.mock("@/lib/billing/cancel", () => ({ cancelAccountBilling }));
const removeAccountDomains = vi.fn(async () => {
  order.push("domains");
  return [] as string[];
});
vi.mock("@/lib/pages/delete-domains", () => ({ removeAccountDomains }));
const removeAccountMedia = vi.fn(async () => {
  order.push("media");
});
vi.mock("@/lib/pages/delete-media", () => ({ removeAccountMedia }));

let injected: string | undefined;
vi.mock("@/lib/testing/faults", () => ({
  failIfInjected: async (name: string) => {
    if (injected === name) throw new Error(`Injected fault: ${name}`);
  },
}));

const { deleteAccount } = await import("@/lib/pages/delete-account");

function form(confirm: string): FormData {
  const data = new FormData();
  data.set("confirm", confirm);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  injected = undefined;
  getSessionUser.mockResolvedValue({ id: "user-1" });
  isAccountSuspended.mockResolvedValue(false);
  cookieStore.get.mockReturnValue(undefined);
  deleteUser.mockImplementation(async () => {
    order.push("delete");
    return { error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("M10-19 deleteAccount disconnects the connected apps first", () => {
  it("runs the disconnect for the session user, before billing, domains, images and the delete", async () => {
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(revokeAllGrants).toHaveBeenCalledWith("user-1");
    expect(order).toEqual(["grants", "billing", "domains", "media", "delete"]);
  });

  it("does not run for a wrong confirmation or a suspended account (the order of those checks is unchanged)", async () => {
    await expect(deleteAccount(null, form("nope"))).resolves.toEqual({
      error: "That doesn’t match your handle. Type it exactly to confirm.",
    });
    expect(revokeAllGrants).not.toHaveBeenCalled();
    isAccountSuspended.mockResolvedValue(true);
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "Your account is suspended, so it can’t be deleted. Contact support to appeal.",
    });
    expect(revokeAllGrants).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it("takes the user from the session, never from the form", async () => {
    const data = form("mara");
    data.set("user_id", "someone-else");
    data.set("userId", "someone-else");
    await expect(deleteAccount(null, data)).rejects.toMatchObject({ to: "/login?deleted=1" });
    expect(revokeAllGrants).toHaveBeenCalledTimes(1);
    expect(revokeAllGrants).toHaveBeenCalledWith("user-1");
  });

  it("when it fails the dialog says so and nothing else runs: no billing, no domain, no image, no delete", async () => {
    revokeAllGrants.mockRejectedValueOnce(new Error("[oauth] revokeAllUserGrants failed (XX000)"));
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t disconnect your apps. Try again.",
    });
    expect(order).toEqual([]);
    expect(cancelAccountBilling).not.toHaveBeenCalled();
    expect(removeAccountDomains).not.toHaveBeenCalled();
    expect(removeAccountMedia).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("the fault-injection hook makes the same path fail, without touching the store", async () => {
    injected = "grants-revoke";
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t disconnect your apps. Try again.",
    });
    expect(revokeAllGrants).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("a retry after the failure goes through", async () => {
    revokeAllGrants.mockRejectedValueOnce(new Error("boom"));
    await deleteAccount(null, form("mara"));
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(order).toEqual(["grants", "billing", "domains", "media", "delete"]);
  });
});
