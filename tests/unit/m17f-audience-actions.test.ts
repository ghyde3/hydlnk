import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rateLimit: vi.fn(),
  calls: [] as unknown[][],
  result: { data: [{ id: "x" }], error: null } as { data: unknown; error: unknown },
}));
vi.mock("@/lib/pages/context", () => ({ getAppContext: mocks.context }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.rateLimit }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ["from", "delete", "eq", "select"]) {
      chain[name] = (...args: unknown[]) => {
        mocks.calls.push([name, ...args]);
        return name === "select" ? Promise.resolve(mocks.result) : chain;
      };
    }
    return chain;
  },
}));

const { deleteFormSubmissions, deleteSubmission } = await import("@/lib/forms/audience-actions");

/**
 * M17-08 step 2: the two delete actions. They take the signed-in user and the current site from the
 * app context (never from the call), validate the argument, are limited to 60 a minute per user and
 * delete with the user's own session (RLS), filtered on the current site as well.
 */

const SITE = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const ROW = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.result = { data: [{ id: ROW }], error: null };
  mocks.context.mockResolvedValue({ user: { id: "user-a" }, current: { id: SITE, access: { isOwner: true } } });
  mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
});
afterEach(() => vi.clearAllMocks());

describe("M17-08 deleting submissions", () => {
  it("one row: a delete on the current site and that id, as the user", async () => {
    expect(await deleteSubmission(ROW.toUpperCase())).toEqual({ ok: true, deleted: 1 });
    expect(mocks.calls).toEqual([
      ["from", "form_submissions"],
      ["delete"],
      ["eq", "site_id", SITE],
      ["eq", "id", ROW],
      ["select", "id"],
    ]);
    expect(mocks.rateLimit).toHaveBeenCalledWith("audience-delete:user-a", 60, 60);
  });

  it("every row of one form on the current site", async () => {
    mocks.result = { data: [{ id: "1" }, { id: "2" }], error: null };
    expect(await deleteFormSubmissions("formCont01")).toEqual({ ok: true, deleted: 2 });
    expect(mocks.calls).toContainEqual(["eq", "site_id", SITE]);
    expect(mocks.calls).toContainEqual(["eq", "block_id", "formCont01"]);
  });

  it("refuses a bad argument before anything else", async () => {
    for (const bad of ["not-a-uuid", 42, null, { id: ROW }]) {
      expect(await deleteSubmission(bad)).toEqual({ ok: false, error: "invalid" });
    }
    for (const bad of ["x", "a/b/c/d/e/f", 7]) {
      expect(await deleteFormSubmissions(bad)).toEqual({ ok: false, error: "invalid" });
    }
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual([]);
  });

  it("past 60 a minute: rate_limited, nothing deleted", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    expect(await deleteSubmission(ROW)).toEqual({ ok: false, error: "rate_limited" });
    expect(mocks.calls).toEqual([]);
  });

  it("a database error is 'failed', logged with its code only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.result = { data: null, error: { code: "42501", message: "row of vera@example.test" } };
    expect(await deleteSubmission(ROW)).toEqual({ ok: false, error: "failed" });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("vera@example.test");
    spy.mockRestore();
  });
});
