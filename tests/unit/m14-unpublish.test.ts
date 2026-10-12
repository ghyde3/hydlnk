import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: vi.fn() }));

const PAGE = "00000000-0000-4000-8000-0000000000B1";
const OWNER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e01";
const OTHER = "6f1c2a52-3a1e-4c0b-9d57-0b8f2f7a1e02";

interface Fake {
  page: { data: { id: string; owner_id: string } | null; error: { message: string } | null };
  account: { data: { suspended_at: string | null } | null; error: { message: string } | null };
  rpc: { data: unknown; error: { code: string; message: string } | null };
  rpcCalls: Array<[string, unknown]>;
  reads: string[];
}

function fakeAdmin(over: Partial<Fake> = {}): { admin: SupabaseClient; fake: Fake } {
  const fake: Fake = {
    page: { data: { id: PAGE, owner_id: OWNER }, error: null },
    account: { data: { suspended_at: null }, error: null },
    rpc: { data: true, error: null },
    rpcCalls: [],
    reads: [],
    ...over,
  };
  const admin = {
    from(table: string) {
      fake.reads.push(table);
      const result = table === "pages" ? fake.page : fake.account;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(result),
      };
      return chain;
    },
    rpc(name: string, args: unknown) {
      fake.rpcCalls.push([name, args]);
      return Promise.resolve(fake.rpc);
    },
  };
  return { admin: admin as unknown as SupabaseClient, fake };
}

const { unpublishSiteCore } = await import("@/lib/publish/unpublish");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("M14-02 unpublishSiteCore: ownership, suspension, one transaction", () => {
  it("calls unpublish_site for the owner of the page and reports what it did", async () => {
    const { admin, fake } = fakeAdmin();
    const result = await unpublishSiteCore({ pageId: PAGE, userId: OWNER }, { admin });
    expect(result).toEqual({ ok: true, wasPublished: true });
    expect(fake.rpcCalls).toEqual([["unpublish_site", { p_page_id: PAGE, p_owner_id: OWNER }]]);
  });

  it("reports a site that was not published as ok, with nothing changed", async () => {
    const { admin } = fakeAdmin({ rpc: { data: false, error: null } });
    expect(await unpublishSiteCore({ pageId: PAGE, userId: OWNER }, { admin })).toEqual({
      ok: true,
      wasPublished: false,
    });
  });

  it("refuses a signed-out caller and a malformed id before reading anything", async () => {
    const { admin, fake } = fakeAdmin();
    expect(await unpublishSiteCore({ pageId: PAGE, userId: null }, { admin })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await unpublishSiteCore({ pageId: "nope", userId: OWNER }, { admin })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(fake.reads).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("refuses a page the session user does not own, or that does not exist, and calls nothing", async () => {
    const other = fakeAdmin();
    expect(
      await unpublishSiteCore({ pageId: PAGE, userId: OTHER }, { admin: other.admin }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(other.fake.rpcCalls).toEqual([]);
    // Ownership first: nothing of the account is read for someone else's page.
    expect(other.fake.reads).toEqual(["pages"]);
    const missing = fakeAdmin({ page: { data: null, error: null } });
    expect(
      await unpublishSiteCore({ pageId: PAGE, userId: OWNER }, { admin: missing.admin }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(missing.fake.rpcCalls).toEqual([]);
  });

  it("refuses a suspended owner and calls nothing", async () => {
    const { admin, fake } = fakeAdmin({
      account: { data: { suspended_at: "2026-10-01" }, error: null },
    });
    expect(await unpublishSiteCore({ pageId: PAGE, userId: OWNER }, { admin })).toEqual({
      ok: false,
      reason: "account_suspended",
    });
    expect(fake.rpcCalls).toEqual([]);
  });

  it("fails closed when a read or the function fails", async () => {
    for (const over of [
      { page: { data: null, error: { message: "boom" } } },
      { account: { data: null, error: { message: "boom" } } },
      { account: { data: null, error: null } },
      { rpc: { data: null, error: { code: "XX000", message: "boom" } } },
    ] satisfies Partial<Fake>[]) {
      const { admin, fake } = fakeAdmin(over);
      const result = await unpublishSiteCore({ pageId: PAGE, userId: OWNER }, { admin });
      expect(result.ok).toBe(false);
      if (over.rpc === undefined) expect(fake.rpcCalls).toEqual([]);
    }
  });
});
