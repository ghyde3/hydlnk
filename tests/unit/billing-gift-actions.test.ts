import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { executeAdminAction } from "@/lib/admin/execute";
import type { Principal } from "@/lib/admin/principal";
import type { AdminDeps } from "@/lib/admin/types";
import { endGiftAction, giftPlanAction, parseGiftEnd } from "@/lib/billing/gift-actions";
import { makeOwner, removeOwners, stackIsUp, type TestOwner } from "./publish-support";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * M13-07 (gift a plan), tested like payments: the real actions with the secret-key client against
 * the local Supabase stack. accounts.plan is the effective plan, derived by the database from
 * paid_plan and the gift; a gift never touches Stripe (the Stripe client is a spy that must stay
 * untouched) and is audited once. The webhook half (a subscription change keeps a gift) calls
 * apply_subscription_state, the function the Stripe webhook writes through.
 */
const stripeSpy = vi.hoisted(() => ({ getStripe: vi.fn(() => ({})) }));
vi.mock("@/lib/billing/stripe", () => stripeSpy);

const { run } = await stackIsUp();

const ADMIN_ID = "11111111-2222-4333-8444-555555555555";
const ADMIN: Principal = { kind: "user", id: ADMIN_ID, email: "admin@example.test", admin: true };
const NO_SUCH = "00000000-0000-4000-8000-0000000000ee";

describe("M13-07 the end date", () => {
  it("reads a day as the end of that day in UTC, an ISO time as itself, nothing as no end", () => {
    expect(parseGiftEnd("2031-12-31")).toBe("2031-12-31T23:59:59.999Z");
    expect(parseGiftEnd("2031-12-31T10:00:00Z")).toBe("2031-12-31T10:00:00.000Z");
    expect(parseGiftEnd("")).toBeNull();
    expect(parseGiftEnd(null)).toBeNull();
    expect(parseGiftEnd(undefined)).toBeNull();
    expect(parseGiftEnd("tomorrow")).toBeUndefined();
    expect(parseGiftEnd("2031-02-31")).toBeUndefined();
  });
});

describe.skipIf(!run)("M13-07 gift_plan and end_gift (local Supabase)", () => {
  let admin: SupabaseClient;
  const owners: TestOwner[] = [];
  const invalidateAccount = vi.fn<AdminDeps["invalidateAccount"]>(async () => 1);

  const deps = (): AdminDeps => ({
    db: admin as never,
    invalidateAccount,
    invalidateHandles: () => undefined,
    isProtectedAccount: async () => false,
    now: () => new Date(),
  });
  const gift = (input: unknown) => executeAdminAction(giftPlanAction, ADMIN, input, deps);
  const endGift = (id: string) => executeAdminAction(endGiftAction, ADMIN, { id }, deps);

  const owner = async (label: string) => {
    const o = await makeOwner(admin, label);
    owners.push(o);
    return o;
  };
  const row = async (id: string) =>
    (
      await admin
        .from("accounts")
        .select(
          "plan, paid_plan, gift_plan, gift_until, gift_reason, gifted_by, stripe_customer_id",
        )
        .eq("id", id)
        .single()
    ).data as Record<string, unknown>;
  const audits = async (id: string) =>
    (
      await admin
        .from("admin_audit")
        .select("admin_id, action, account_id, detail")
        .eq("account_id", id)
        .in("action", ["gift_plan", "end_gift"])
        .order("id")
    ).data ?? [];
  /** What the Stripe webhook does to an account: the one function it writes through. */
  const webhookApplies = async (id: string, plan: "free" | "pro" | "studio", at: string) => {
    const { error } = await admin.rpc("apply_subscription_state", {
      p_account_id: id,
      p_event_created: at,
      p_subscription_id: plan === "free" ? null : `sub_gift_${id.slice(0, 8)}`,
      p_plan: plan,
      p_interval: plan === "free" ? null : "month",
      p_period_end: plan === "free" ? null : "2031-01-01T00:00:00Z",
      p_cancel_at_period_end: false,
    });
    expect(error).toBeNull();
  };

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });
  afterAll(async () => {
    if (admin) await removeOwners(admin, owners);
  });

  it("gives Pro to a Free account: effective plan Pro, paid plan Free, the gift columns, one audit row, caches expired, Stripe untouched", async () => {
    const o = await owner("gift-pro");
    const result = await gift({
      id: o.userId,
      plan: "pro",
      until: "2099-12-31",
      reason: " support ",
    });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { changed: true, plan: "pro", effectivePlan: "pro", paidPlan: "free" },
    });
    const state = await row(o.userId);
    expect(state).toMatchObject({
      plan: "pro",
      paid_plan: "free",
      gift_plan: "pro",
      gift_reason: "support",
      gifted_by: ADMIN_ID,
      stripe_customer_id: null,
    });
    expect(new Date(state.gift_until as string).toISOString()).toBe("2099-12-31T23:59:59.999Z");
    const trail = await audits(o.userId);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      admin_id: ADMIN_ID,
      action: "gift_plan",
      detail: { plan: "pro", reason: "support", effective_plan: "pro", paid_plan: "free" },
    });
    expect(invalidateAccount).toHaveBeenCalledWith(o.userId);
    expect(stripeSpy.getStripe).not.toHaveBeenCalled();
  });

  it("a second gift replaces the first; ending it returns the account to Free with the pages kept", async () => {
    const o = await owner("gift-end");
    expect(await gift({ id: o.userId, plan: "studio" })).toMatchObject({ ok: true });
    expect((await row(o.userId)).plan).toBe("studio");
    // Studio allows more pages than Free: add two under the gift.
    for (const suffix of ["a", "b", "c"]) {
      const { error } = await admin
        .from("pages")
        .insert({ owner_id: o.userId, handle: `${o.handle}-${suffix}`, draft: { version: 1 } });
      expect(error).toBeNull();
    }
    const before = (await admin.from("pages").select("id").eq("owner_id", o.userId)).data!.length;

    expect(await gift({ id: o.userId, plan: "pro", until: "2099-01-01" })).toMatchObject({
      ok: true,
    });
    expect(await row(o.userId)).toMatchObject({ plan: "pro", gift_plan: "pro" });

    const ended = await endGift(o.userId);
    expect(ended).toMatchObject({
      ok: true,
      data: { changed: true, effectivePlan: "free", paidPlan: "free" },
    });
    expect(await row(o.userId)).toMatchObject({
      plan: "free",
      paid_plan: "free",
      gift_plan: null,
      gift_until: null,
      gift_reason: null,
      gifted_by: null,
    });
    expect((await admin.from("pages").select("id").eq("owner_id", o.userId)).data!.length).toBe(
      before,
    );
    expect((await audits(o.userId)).map((r) => r.action)).toEqual([
      "gift_plan",
      "gift_plan",
      "end_gift",
    ]);
    expect(stripeSpy.getStripe).not.toHaveBeenCalled();
  });

  it("ending a gift that is not held is a 200 with changed:false and no audit row; an unknown account is a 404", async () => {
    const o = await owner("gift-none");
    expect(await endGift(o.userId)).toMatchObject({
      ok: true,
      status: 200,
      data: { changed: false },
    });
    expect(await audits(o.userId)).toEqual([]);
    expect(await endGift(NO_SUCH)).toMatchObject({ ok: false, status: 404, error: "not_found" });
    expect(await gift({ id: NO_SUCH, plan: "pro" })).toMatchObject({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });

  it("refuses bad input with a 400 and changes and records nothing", async () => {
    const o = await owner("gift-bad");
    const calls = invalidateAccount.mock.calls.length;
    for (const input of [
      { id: o.userId, plan: "free" },
      { id: o.userId, plan: "enterprise" },
      { id: o.userId },
      { id: o.userId, plan: "pro", until: "2001-01-01" },
      { id: o.userId, plan: "pro", until: "not a date" },
      { id: o.userId, plan: "pro", reason: "x".repeat(501) },
      { id: "nope", plan: "pro" },
      { id: o.userId, plan: "pro", until: 5 },
    ]) {
      expect(await gift(input), JSON.stringify(input)).toMatchObject({
        ok: false,
        status: 400,
        error: "invalid_input",
      });
    }
    expect(await row(o.userId)).toMatchObject({ plan: "free", gift_plan: null });
    expect(await audits(o.userId)).toEqual([]);
    expect(invalidateAccount.mock.calls.length).toBe(calls);
  });

  it("a gift lower than what the account pays for is recorded and changes nothing, and the message says so", async () => {
    const o = await owner("gift-lower");
    await webhookApplies(o.userId, "studio", "2031-01-01T00:00:00Z");
    expect(await gift({ id: o.userId, plan: "pro" })).toMatchObject({
      ok: true,
      data: { effectivePlan: "studio", paidPlan: "studio" },
    });
    expect(await row(o.userId)).toMatchObject({
      plan: "studio",
      paid_plan: "studio",
      gift_plan: "pro",
    });
  });

  it("the webhook with a gift: a change and a cancellation keep the gift; ending it returns to the paid plan", async () => {
    const o = await owner("gift-webhook");
    expect(await gift({ id: o.userId, plan: "studio" })).toMatchObject({ ok: true });

    // Subscribes to Pro under a Studio gift: paid_plan is Pro, the plan stays Studio.
    await webhookApplies(o.userId, "pro", "2031-01-01T00:00:01Z");
    expect(await row(o.userId)).toMatchObject({
      plan: "studio",
      paid_plan: "pro",
      gift_plan: "studio",
    });

    // The subscription is canceled: paid plan Free, the gift still holds.
    await webhookApplies(o.userId, "free", "2031-01-01T00:00:02Z");
    expect(await row(o.userId)).toMatchObject({
      plan: "studio",
      paid_plan: "free",
      gift_plan: "studio",
    });

    // Subscribes again, then the gift ends: back to the paid plan, not to Free.
    await webhookApplies(o.userId, "pro", "2031-01-01T00:00:03Z");
    expect(await endGift(o.userId)).toMatchObject({
      ok: true,
      data: { changed: true, effectivePlan: "pro", paidPlan: "pro" },
    });
    expect(await row(o.userId)).toMatchObject({ plan: "pro", paid_plan: "pro", gift_plan: null });
    expect(stripeSpy.getStripe).not.toHaveBeenCalled();
  });
});
