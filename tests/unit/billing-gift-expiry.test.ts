import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SECRET = "cron-secret-value-for-unit-tests";
vi.mock("@/lib/env/server", () => ({
  serverEnv: { CRON_SECRET: "cron-secret-value-for-unit-tests" },
}));
const sweep = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/gift-expiry", () => ({ sweepExpiredGifts: sweep }));
vi.mock("@/lib/publish/invalidate", () => ({ invalidateAccountPages: async () => 1 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabase: () => ({}) }));

const { sweepExpiredGifts } = await vi.importActual<typeof import("@/lib/billing/gift-expiry")>(
  "@/lib/billing/gift-expiry",
);
const { POST } = await import("@/app/(editor)/app/api/cron/end-expired-gifts/route");

const post = (
  headers: Record<string, string> = {},
  url = "http://app.localhost:3000/api/cron/end-expired-gifts",
) => POST(new NextRequest(url, { method: "POST", headers }));

describe("M13-07 POST /api/cron/end-expired-gifts", () => {
  beforeEach(() => sweep.mockReset());

  it("a missing or wrong secret is a 401 and runs nothing; a secret in the URL is ignored", async () => {
    for (const headers of [
      {},
      { authorization: "Bearer wrong" },
      { authorization: SECRET },
    ] as Record<string, string>[]) {
      const res = await post(headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(
      (await post({}, `http://app.localhost:3000/api/cron/end-expired-gifts?secret=${SECRET}`))
        .status,
    ).toBe(401);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("the right secret runs the sweep and answers the count, uncached", async () => {
    sweep.mockResolvedValue({ ended: 2, failed: 0 });
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ended: 2 });
  });

  it("a failed page expiry or a failed sweep is a 500 without detail", async () => {
    sweep.mockResolvedValueOnce({ ended: 1, failed: 1 });
    expect((await post({ authorization: `Bearer ${SECRET}` })).status).toBe(500);
    sweep.mockRejectedValueOnce(new Error("boom with a secret"));
    const res = await post({ authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });
});

describe("sweepExpiredGifts", () => {
  it("expires the pages of every ended account, keeps going after a failure and counts it", async () => {
    const db = {
      rpc: async () => ({
        data: [{ account_id: "a" }, { account_id: "b" }, { account_id: "c" }],
        error: null,
      }),
    } as unknown as SupabaseClient;
    const seen: string[] = [];
    const out = await sweepExpiredGifts({
      db,
      invalidateAccount: async (id) => {
        seen.push(id);
        if (id === "b") throw new Error("cache down");
        return 1;
      },
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(out).toEqual({ ended: 3, failed: 1 });
  });

  it("nothing due is nothing to expire; a database error throws", async () => {
    const none = { rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient;
    const spy = vi.fn(async () => 1);
    expect(await sweepExpiredGifts({ db: none, invalidateAccount: spy })).toEqual({
      ended: 0,
      failed: 0,
    });
    expect(spy).not.toHaveBeenCalled();
    const bad = {
      rpc: async () => ({ data: null, error: { message: "x" } }),
    } as unknown as SupabaseClient;
    await expect(sweepExpiredGifts({ db: bad, invalidateAccount: spy })).rejects.toThrow();
  });
});

const { run } = await stackIsUp();

describe.skipIf(!run)("the sweep against the local database", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];
  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });
  afterAll(async () => {
    await removeOwners(admin, owners);
  });

  it("ends an expired gift, expires that account's pages, and writes one system end_gift row", async () => {
    const o = await makeOwner(admin, "gift-expiry");
    owners.push(o);
    const given = await admin.rpc("admin_set_gift", {
      p_account: o.userId,
      p_plan: "pro",
      p_until: new Date(Date.now() + 3_600_000).toISOString(),
      p_reason: "trial",
      p_admin: "99999999-8888-4777-8666-555555555555",
    });
    expect(given.data).toBe("ok");
    await admin
      .from("accounts")
      .update({ gift_until: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", o.userId);

    const invalidated: string[] = [];
    const out = await sweepExpiredGifts({
      db: admin,
      invalidateAccount: async (id) => {
        invalidated.push(id);
        return 1;
      },
    });
    expect(out.failed).toBe(0);
    expect(invalidated).toContain(o.userId);
    const account = await admin
      .from("accounts")
      .select("plan, gift_plan")
      .eq("id", o.userId)
      .single();
    expect(account.data).toEqual({ plan: "free", gift_plan: null });
    const audit = await admin
      .from("admin_audit")
      .select("admin_id, action, detail")
      .eq("account_id", o.userId)
      .eq("action", "end_gift");
    expect(audit.data).toEqual([
      {
        admin_id: "00000000-0000-0000-0000-000000000000",
        action: "end_gift",
        detail: { expired: true, gift_plan: "pro" },
      },
    ]);
    // Running it again finds nothing for this account.
    const again: string[] = [];
    await sweepExpiredGifts({ db: admin, invalidateAccount: async (id) => (again.push(id), 1) });
    expect(again).not.toContain(o.userId);
  });
});
