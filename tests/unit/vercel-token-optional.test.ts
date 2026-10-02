import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * VERCEL_API_TOKEN is optional at build and startup (production has none until the custom-domains
 * wave). Whatever has to call the Vercel API (adding or removing a custom domain) fails closed
 * with a clear error while it is missing and makes no request; deleting an account or a page that
 * has NO domain rows never reaches the Vercel client, so it never needs the token. The real
 * delete code runs here with the token unset and only the database, Stripe and Storage replaced.
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
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, delete: () => undefined }),
}));

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const PAGE = {
  id: "00000000-0000-4000-8000-0000000000a1",
  handle: "mara",
  created_at: "2026-01-01",
};
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: [PAGE], error: null }) }) }),
    }),
    auth: { signOut: async () => ({ error: null }) },
  }),
}));

/** The domain rows the fake admin client returns for the account's pages. */
let domainRows: { hostname: string }[] = [];
const domainQueries = vi.fn();
const deleteUser = vi.fn<(id: string) => Promise<{ error: null }>>(async () => ({ error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async (_column: string, ids: string[]) => {
          domainQueries(table, ids);
          return { data: domainRows, error: null };
        },
      }),
    }),
    auth: { admin: { deleteUser } },
  }),
}));
// M5-09: a suspended account cannot delete (covered in delete-account-cache.test.ts); here it is active.
vi.mock("@/lib/admin/suspension", () => ({ isAccountSuspended: async () => false }));
const cancelAccountBilling = vi.fn<(id: string) => Promise<number>>(async () => 0);
vi.mock("@/lib/billing/cancel", () => ({ cancelAccountBilling }));
const removeAccountMedia = vi.fn<(id: string) => Promise<void>>(async () => undefined);
vi.mock("@/lib/pages/delete-media", () => ({ removeAccountMedia }));

const BASE_ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_unit",
  NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_unit",
};
const M4_ENV: Record<string, string> = {
  VERCEL_PROJECT_ID: "prj_unit",
  VERCEL_TEAM_ID: "team_unit",
  STRIPE_PRICE_PRO_MONTHLY: "price_pm",
  STRIPE_PRICE_PRO_YEARLY: "price_py",
  STRIPE_PRICE_STUDIO_MONTHLY: "price_sm",
  STRIPE_PRICE_STUDIO_YEARLY: "price_sy",
  CRON_SECRET: "cron-secret-value",
  VISITOR_HASH_SECRET: "visitor-secret-value",
};
const MANAGED = [
  ...Object.keys(BASE_ENV),
  ...Object.keys(M4_ENV),
  "VERCEL_API_TOKEN",
  "VERCEL_API_BASE_URL",
  "VERCEL_ENV",
  "STRIPE_API_HOST",
];

// Set before the modules below are imported (the client env module validates when first imported).
Object.assign(process.env, BASE_ENV);

const saved: Record<string, string | undefined> = {};
let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const key of MANAGED) saved[key] = process.env[key];
  Object.assign(process.env, BASE_ENV);
  delete process.env.VERCEL_API_TOKEN;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_API_BASE_URL;
  delete process.env.STRIPE_API_HOST;
  process.env.VERCEL_PROJECT_ID = "prj_unit";
  process.env.VERCEL_TEAM_ID = "team_unit";
  domainRows = [];
  domainQueries.mockClear();
  deleteUser.mockClear();
  cancelAccountBilling.mockClear();
  removeAccountMedia.mockClear();
  getSessionUser.mockResolvedValue({ id: "user-1" });
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("no network in this test");
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const { readVercelApiConfig, VercelNotConfiguredError } = await import("@/lib/pages/vercel-config");
const { removeVercelDomain } = await import("@/lib/pages/remove-domain");
const { removeAccountDomains } = await import("@/lib/pages/delete-domains");
const { deleteAccount } = await import("@/lib/pages/delete-account");

describe("startup and build do not need the token", () => {
  it("the server env module imports on a production deployment without VERCEL_API_TOKEN", async () => {
    vi.resetModules();
    Object.assign(process.env, M4_ENV, {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.com",
    });
    const { serverEnv } = await import("@/lib/env/server");
    expect(serverEnv.VERCEL_API_TOKEN).toBeUndefined();
    expect(serverEnv.VERCEL_PROJECT_ID).toBe("prj_unit");
  });

  it("and still stops the build when another required variable is missing, naming it", async () => {
    vi.resetModules();
    Object.assign(process.env, M4_ENV, {
      VERCEL_ENV: "production",
      NEXT_PUBLIC_ROOT_DOMAIN: "hydlnk.com",
    });
    delete process.env.CRON_SECRET;
    await expect(import("@/lib/env/server")).rejects.toThrow(/CRON_SECRET/);
  });
});

describe("what calls the Vercel API fails closed without the token", () => {
  it("readVercelApiConfig names the missing variable and what it blocks, never a value", () => {
    expect(() => readVercelApiConfig()).toThrow(VercelNotConfiguredError);
    expect(() => readVercelApiConfig()).toThrow(
      /VERCEL_API_TOKEN is not set\. Adding or removing a custom domain needs the Vercel API/,
    );
    delete process.env.VERCEL_PROJECT_ID;
    let message = "";
    try {
      readVercelApiConfig();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/VERCEL_API_TOKEN and VERCEL_PROJECT_ID are not set/);
    expect(message).not.toContain("team_unit");
  });

  it("returns the token, project, team and a base URL without a trailing slash once configured", () => {
    process.env.VERCEL_API_TOKEN = "tok_unit";
    expect(readVercelApiConfig()).toEqual({
      token: "tok_unit",
      projectId: "prj_unit",
      teamId: "team_unit",
      baseUrl: "https://api.vercel.com",
    });
    process.env.VERCEL_API_BASE_URL = "http://127.0.0.1:12112/";
    delete process.env.VERCEL_TEAM_ID;
    expect(readVercelApiConfig()).toMatchObject({
      baseUrl: "http://127.0.0.1:12112",
      teamId: undefined,
    });
  });

  it("an empty token counts as unset", () => {
    process.env.VERCEL_API_TOKEN = "";
    expect(() => readVercelApiConfig()).toThrow(VercelNotConfiguredError);
  });

  it("removing a custom domain throws the clear error and makes no request", async () => {
    await expect(removeVercelDomain("links.example.com")).rejects.toThrow(VercelNotConfiguredError);
    await expect(removeVercelDomain("links.example.com")).rejects.toThrow(
      /VERCEL_API_TOKEN is not set/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("also in production: the call is refused, not skipped", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "hydlnk.com"; // restored with the rest of BASE_ENV
    await expect(removeVercelDomain("links.example.com")).rejects.toThrow(/not set/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with the token set it still makes the one DELETE request", async () => {
    process.env.VERCEL_API_TOKEN = "tok_unit";
    fetchSpy.mockImplementation(async () => new Response("{}", { status: 200 }));
    await removeVercelDomain("links.example.com");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.vercel.com/v9/projects/prj_unit/domains/links.example.com?teamId=team_unit",
    );
    expect(init).toMatchObject({ method: "DELETE", headers: { Authorization: "Bearer tok_unit" } });
  });
});

describe("deleting an account with no domain rows never needs the token", () => {
  it("removeAccountDomains with no pages makes no query and no request", async () => {
    await expect(removeAccountDomains([])).resolves.toBeUndefined();
    expect(domainQueries).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removeAccountDomains with pages that have no domain rows resolves without touching Vercel", async () => {
    await expect(removeAccountDomains([PAGE.id])).resolves.toBeUndefined();
    expect(domainQueries).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the whole deleteAccount action completes with the token unset when there are no domains", async () => {
    const data = new FormData();
    data.set("confirm", "mara");
    await expect(deleteAccount(null, data)).rejects.toMatchObject({ to: "/login?deleted=1" });
    expect(deleteUser).toHaveBeenCalledWith("user-1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a domain row it fails closed: the dialog message, no request, nothing deleted", async () => {
    domainRows = [{ hostname: "links.example.com" }];
    const data = new FormData();
    data.set("confirm", "mara");
    await expect(deleteAccount(null, data)).resolves.toEqual({
      error: "We couldn’t remove your custom domain. Try again.",
    });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(removeAccountMedia).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The reason is in the server log, in words.
    expect(
      JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls),
    ).toMatch(/VERCEL_API_TOKEN is not set/);
  });
});

const { deletePageWithClient } = await import("@/lib/pages/delete-page-core");

describe("deleting a page with no domain rows never needs the token", () => {
  /** A just-enough admin client: one page, `hosts` as its domain rows, deletes recorded. */
  function client(hosts: string[]) {
    const deleted: string[] = [];
    const admin = {
      from(table: string) {
        if (table === "domains") {
          return {
            select: () => ({
              eq: async () => ({ data: hosts.map((hostname) => ({ hostname })), error: null }),
            }),
          };
        }
        if (table === "accounts") {
          // The suspension check of a page delete (M5-09): an active account.
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { suspended_at: null }, error: null }),
              }),
            }),
          };
        }
        return {
          select: (_columns: string, options?: { head?: boolean }) =>
            options?.head
              ? { eq: async () => ({ count: 0, error: null }) }
              : {
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: async () => ({
                        data: { id: PAGE.id, handle: PAGE.handle },
                        error: null,
                      }),
                    }),
                  }),
                },
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => {
                  deleted.push(PAGE.id);
                  return { data: [{ id: PAGE.id }], error: null };
                },
              }),
            }),
          }),
        };
      },
    };
    return { admin, deleted };
  }
  const input = { userId: "user-1", pageId: PAGE.id, confirm: PAGE.handle };
  const deps = { removeDomain: (hostname: string) => removeVercelDomain(hostname) };

  it("deletes the page and asks Vercel nothing", async () => {
    const { admin, deleted } = client([]);
    const result = await deletePageWithClient(admin as never, input, deps);
    expect(result).toMatchObject({ ok: true, handle: PAGE.handle });
    expect(deleted).toEqual([PAGE.id]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with a domain row it fails closed: 502 domain_removal_failed, the page stays, no request", async () => {
    const { admin, deleted } = client(["links.example.com"]);
    const result = await deletePageWithClient(admin as never, input, deps);
    expect(result).toMatchObject({ ok: false, status: 502, error: "domain_removal_failed" });
    expect(deleted).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
