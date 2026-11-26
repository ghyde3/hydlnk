// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * S1 and S7 (M19-08): the session's sign-in methods reach the database, and the invite cookie never
 * outlives its use. `acceptInvite` drops `hl_invite` on every final answer (the wrong account, a used
 * link, a password-only session) and keeps it only for a passing failure; sign-out drops it; "Not
 * now" on /invite drops it.
 */

vi.mock("server-only", () => ({}));

const jar = new Map<string, string>();
const deleted: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    delete: (name: string) => {
      deleted.push(name);
      jar.delete(name);
    },
    set: (name: string, value: string) => jar.set(name, value),
  }),
}));
class Redirect extends Error {
  constructor(public to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const claims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getClaims: claims, signOut: async () => ({ error: null }) },
  }),
}));
vi.mock("@/lib/auth/accounts", () => ({ ensureAccount: async () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));
vi.mock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_ROOT_DOMAIN: "localhost:3000" } }));
vi.mock("@/lib/domains/email-env", () => ({ serverEmailEnv: () => ({}) }));
vi.mock("@/lib/domains/email", () => ({ sendMessage: async () => "skipped" }));
vi.mock("@/lib/pages/current-cookie", () => ({ setCurrentPageCookie: async () => undefined }));
const allowed = vi.fn(async () => ({ allowed: true }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => allowed() }));
const accept = vi.fn();
vi.mock("@/lib/team/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/team/core")>()),
  acceptInviteCore: (...args: unknown[]) => accept(...args),
}));

const { authMethods } = await import("@/lib/auth/session");
const { acceptInvite, dismissInvite } = await import("@/lib/team/actions");
const { signOut } = await import("@/lib/auth/actions");
const { teamFailure } = await import("@/lib/team/core");

const TOKEN = "A".repeat(43);
const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  jar.clear();
  deleted.length = 0;
  jar.set("hl_invite", TOKEN);
  accept.mockReset();
  claims.mockResolvedValue({
    data: { claims: { sub: USER, email: "m@example.com", amr: [{ method: "otp", timestamp: 1 }] } },
    error: null,
  });
});

const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Redirect) return { redirected: err.to };
    throw err;
  }
};

describe("S1 the session's sign-in methods", () => {
  it("reads Supabase's amr objects and plain strings, and nothing else", () => {
    expect(authMethods([{ method: "otp", timestamp: 1 }, { method: "password" }])).toEqual(["otp", "password"]);
    expect(authMethods(["oauth"])).toEqual(["oauth"]);
    expect(authMethods([{ method: 7 }, null, "", {}])).toEqual([]);
    expect(authMethods(undefined)).toEqual([]);
    expect(authMethods("otp")).toEqual([]);
  });

  it("acceptInvite passes the session's methods to the database", async () => {
    claims.mockResolvedValue({
      data: { claims: { sub: USER, email: "m@example.com", amr: [{ method: "password", timestamp: 1 }] } },
      error: null,
    });
    accept.mockResolvedValue(teamFailure("invite_session"));
    expect(await run(() => acceptInvite(null, new FormData()))).toEqual({
      message: teamFailure("invite_session").message,
    });
    expect(accept).toHaveBeenCalledWith(expect.anything(), { userId: USER, token: TOKEN, methods: ["password"] });
  });
});

describe("S7 the invite cookie", () => {
  it.each(["invite_email", "invite_used", "invite_session", "team_plan", "team_limit"] as const)(
    "a final answer (%s) drops the cookie and records why for /invite",
    async (error) => {
      accept.mockResolvedValue(teamFailure(error));
      await run(() => acceptInvite(null, new FormData()));
      expect(deleted).toContain("hl_invite");
      expect(jar.has("hl_invite")).toBe(false);
      expect(jar.get("hl_invite_result")).toBe(error);
    },
  );

  it.each(["rate_limited", "error"] as const)("a passing failure (%s) keeps it for another try", async (error) => {
    accept.mockResolvedValue(teamFailure(error));
    await run(() => acceptInvite(null, new FormData()));
    expect(deleted).toEqual([]);
  });

  it("a joined invite drops it and opens the editor", async () => {
    accept.mockResolvedValue({ ok: true, siteId: "22222222-2222-4222-8222-222222222222" });
    expect(await run(() => acceptInvite(null, new FormData()))).toEqual({ redirected: "/editor" });
    expect(deleted).toContain("hl_invite");
    expect(jar.has("hl_invite")).toBe(false);
  });

  it("signing out drops it", async () => {
    expect(await run(() => signOut())).toEqual({ redirected: "/login" });
    expect(deleted).toContain("hl_invite");
  });

  it("Not now drops it and goes home", async () => {
    expect(await run(() => dismissInvite())).toEqual({ redirected: "/" });
    expect(deleted).toContain("hl_invite");
    expect(jar.has("hl_invite")).toBe(false);
  });
});
