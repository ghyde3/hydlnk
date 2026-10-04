import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M8-11, the two deletions that take domains with them by cascade: deleting a page (M4-19) and
 * deleting an account (M4-34). Each expires the hostname lookup of every domain it held, after the
 * database delete succeeded and not when it failed, and a failing expiry changes no result.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn(),
}));

const order: string[] = [];
const expireDomainHost = vi.fn(
  (hostname: unknown) => void order.push(`expire:${String(hostname)}`),
);
vi.mock("@/lib/domains/expire-host", () => ({ expireDomainHost }));

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

const PAGE = "00000000-0000-4000-8000-0000000000a1";
const PAGES = [{ id: PAGE, handle: "mara", created_at: "2026-01-01" }];
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: PAGES, error: null }) }) }),
    }),
    auth: { signOut: async () => ({ error: null }) },
  }),
}));
const deleteUser = vi.fn<(id: string) => Promise<{ error: { message: string } | null }>>(
  async () => {
    order.push("deleteUser");
    return { error: null };
  },
);
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({ auth: { admin: { deleteUser } } }),
}));
vi.mock("@/lib/admin/suspension", () => ({ isAccountSuspended: async () => false }));
vi.mock("@/lib/billing/cancel", () => ({ cancelAccountBilling: async () => 0 }));
const removeAccountDomains = vi.fn<(ids: readonly string[]) => Promise<string[]>>(async () => {
  order.push("domains");
  return ["one.example.test", "two.example.test"];
});
vi.mock("@/lib/pages/delete-domains", () => ({ removeAccountDomains }));
vi.mock("@/lib/pages/delete-media", () => ({ removeAccountMedia: async () => undefined }));
vi.mock("@/lib/publish/invalidate", () => ({ expireDeletedPages: vi.fn() }));

const { deleteAccount } = await import("@/lib/pages/delete-account");
const { deletePageWithClient } = await import("@/lib/pages/delete-page-core");

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
  deleteUser.mockImplementation(async () => {
    order.push("deleteUser");
    return { error: null };
  });
  expireDomainHost.mockImplementation(
    (hostname: unknown) => void order.push(`expire:${String(hostname)}`),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("M8-11 account deletion expires every hostname of the account once the user is gone", () => {
  it("removes the domains at Vercel, deletes the user, then expires each hostname", async () => {
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(order).toEqual([
      "domains",
      "deleteUser",
      "expire:one.example.test",
      "expire:two.example.test",
    ]);
  });

  it("a failed user deletion expires nothing (the domain rows are still there)", async () => {
    deleteUser.mockImplementationOnce(async () => {
      order.push("deleteUser");
      return { error: { message: "nope" } };
    });
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t delete your account. Try again in a moment.",
    });
    expect(expireDomainHost).not.toHaveBeenCalled();
  });

  it("a failed domain removal stops before the delete and expires nothing", async () => {
    removeAccountDomains.mockRejectedValueOnce(new Error("vercel is down"));
    await expect(deleteAccount(null, form("mara"))).resolves.toEqual({
      error: "We couldn’t remove your custom domain. Try again.",
    });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(expireDomainHost).not.toHaveBeenCalled();
  });

  it("an account with no domains expires nothing", async () => {
    removeAccountDomains.mockResolvedValueOnce([]);
    await expect(deleteAccount(null, form("mara"))).rejects.toMatchObject({
      to: "/login?deleted=1",
    });
    expect(expireDomainHost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// deletePageWithClient against a recording fake
// ---------------------------------------------------------------------------------------------

type Result = { data: unknown; error: unknown; count?: number };

/** A chainable stand-in for the secret-key client: every table call returns a thenable chain that answers from `script`. */
function fakeAdmin(script: {
  domains: string[];
  pageDeleteError?: boolean;
  pageDeleteRows?: number;
}) {
  const log: string[] = [];
  const admin = {
    from(table: string) {
      let op = "select";
      let head = false;
      const settle = (): Result => {
        log.push(`${table}.${op}${head ? ".count" : ""}`);
        if (table === "accounts") return { data: { suspended_at: null }, error: null };
        if (table === "domains")
          return { data: script.domains.map((hostname) => ({ hostname })), error: null };
        if (table === "pages" && op === "delete") {
          if (script.pageDeleteError) return { data: null, error: { message: "db down" } };
          return {
            data: Array.from({ length: script.pageDeleteRows ?? 1 }, () => ({ id: PAGE })),
            error: null,
          };
        }
        if (table === "pages" && head) return { data: null, error: null, count: 0 };
        return { data: { id: PAGE, handle: "mara" }, error: null };
      };
      const chain: Record<string, unknown> = {
        select(_cols?: string, options?: { head?: boolean }) {
          if (op !== "delete") op = "select";
          head = options?.head === true;
          return chain;
        },
        delete() {
          op = "delete";
          return chain;
        },
        eq: () => chain,
        maybeSingle: async () => settle(),
        then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(settle()).then(resolve, reject),
      };
      return chain;
    },
  };
  return { admin: admin as unknown as SupabaseClient, log };
}

describe("M8-11 page deletion expires every hostname of the page after the page row is deleted", () => {
  const input = { userId: "00000000-0000-4000-8000-0000000000f1", pageId: PAGE, confirm: "mara" };

  it("removes each domain at the host first, deletes the page, then expires each hostname", async () => {
    const { admin, log } = fakeAdmin({ domains: ["one.example.test", "two.example.test"] });
    const result = await deletePageWithClient(admin, input, {
      removeDomain: async (hostname) => void order.push(`vercel:${hostname}`),
    });
    expect(result).toMatchObject({ ok: true, handle: "mara" });
    expect(order).toEqual([
      "vercel:one.example.test",
      "vercel:two.example.test",
      "expire:one.example.test",
      "expire:two.example.test",
    ]);
    expect(log.indexOf("pages.delete")).toBeGreaterThan(-1);
  });

  it("a page with no domains expires nothing", async () => {
    const { admin } = fakeAdmin({ domains: [] });
    expect(
      (await deletePageWithClient(admin, input, { removeDomain: async () => undefined })).ok,
    ).toBe(true);
    expect(expireDomainHost).not.toHaveBeenCalled();
  });

  it("a failed delete, a refused confirmation and a domain that cannot be removed expire nothing", async () => {
    const failing = fakeAdmin({ domains: ["one.example.test"], pageDeleteError: true });
    expect(
      await deletePageWithClient(failing.admin, input, { removeDomain: async () => undefined }),
    ).toMatchObject({
      ok: false,
      error: "delete_failed",
    });
    const raced = fakeAdmin({ domains: ["one.example.test"], pageDeleteRows: 0 });
    expect(
      await deletePageWithClient(raced.admin, input, { removeDomain: async () => undefined }),
    ).toMatchObject({
      ok: false,
      error: "not_found",
    });
    const wrong = fakeAdmin({ domains: ["one.example.test"] });
    expect(
      await deletePageWithClient(
        wrong.admin,
        { ...input, confirm: "nope" },
        { removeDomain: async () => undefined },
      ),
    ).toMatchObject({ ok: false, error: "confirmation_mismatch" });
    const stuck = fakeAdmin({ domains: ["one.example.test"] });
    expect(
      await deletePageWithClient(stuck.admin, input, {
        removeDomain: async () => {
          throw new Error("vercel is down");
        },
      }),
    ).toMatchObject({ ok: false, error: "domain_removal_failed" });
    expect(expireDomainHost).not.toHaveBeenCalled();
  });
});
