import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  fail,
  type ActionResult,
  type AdminAction,
  type AdminActionContext,
} from "@/lib/admin/types";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The two admin actions behind /admin/accounts/{id}/gift (M13-07): give Pro or Studio, and end the gift.
 *
 * They are `AdminAction`s like the blocked-links ones (listed in `ADMIN_ACTIONS` by
 * `@/lib/admin/actions`), so they are reached only through `executeAdminAction`: nobody signed in
 * gets 401 and a non-admin 403 before the input is read or a database client is built. This file
 * imports nothing from the admin library but its types.
 *
 * A gift never touches Stripe: nothing here imports the Stripe client, and the writes are the two
 * service-role functions `admin_set_gift` and `admin_end_gift`. The database recomputes the effective
 * plan (`accounts.plan`) from `paid_plan` and the gift in a trigger, so this code never writes `plan`.
 * After the change the account's cached public pages are expired (the badge follows the plan), and
 * one `admin_audit` row is written (`gift_plan` or `end_gift`) right after the state change; a failure
 * to write it fails the action (500) and the retry replays the same idempotent state change and
 * writes the row.
 *
 * Ending a gift that is not held answers 200 with `changed: false`; it writes nothing unless the newest
 * gift row of the account is still the gift (an earlier call ended it and died before its audit row):
 * then the missing `end_gift` row is written with `retried: true`. A gift that ran out is ended by the
 * expiry sweep (`/api/cron/end-expired-gifts`), which writes its own system `end_gift` row.
 */

export const GIFT_REASON_MAX = 500;

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export const INVALID_GIFT_MESSAGE = "That request isn’t valid.";
export const PAST_END_MESSAGE = "The end date must be in the future.";
export const BAD_END_MESSAGE = "Enter the end date as a day, like 2026-12-31.";
export const LONG_REASON_MESSAGE = `The reason can be at most ${GIFT_REASON_MAX} characters.`;

const giftInput = z.object({
  id: z.guid(),
  plan: z.enum(["pro", "studio"]),
  // A day (YYYY-MM-DD, the gift lasts through that day, UTC), a full ISO time, or nothing.
  until: z.union([z.string().max(40), z.null()]).optional(),
  reason: z.union([z.string(), z.null()]).optional(),
});

const idInput = z.object({ id: z.guid() });

type Db = SupabaseClient;
const looseDb = (context: AdminActionContext): Db => context.deps.db as unknown as Db;

/** The end of the gift as an ISO time, or null for no end date; `undefined` when it is not a date. */
export function parseGiftEnd(value: string | null | undefined): string | null | undefined {
  const text = (value ?? "").trim();
  if (text === "") return null;
  const iso = dateOnly.test(text) ? `${text}T23:59:59.999Z` : text;
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return undefined;
  // A day that does not exist (2026-02-31) rolls over in Date: refuse it.
  if (dateOnly.test(text) && time.toISOString().slice(0, 10) !== text) return undefined;
  return time.toISOString();
}

async function writeAudit(
  context: AdminActionContext,
  action: "gift_plan" | "end_gift",
  accountId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await context.deps.db.from("admin_audit").insert({
    admin_id: context.actor.id,
    action,
    account_id: accountId,
    report_id: null,
    detail: detail as Json,
  });
  if (error) throw new Error(`Writing the audit log failed: ${error.message}`);
}

async function readPlans(
  context: AdminActionContext,
  accountId: string,
): Promise<{ plan: string; paidPlan: string }> {
  const { data, error } = await looseDb(context)
    .from("accounts")
    .select("plan, paid_plan")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Reading the account failed: ${error.message}`);
  const row = data as { plan: string; paid_plan: string } | null;
  if (!row) throw new Error("The account vanished during the gift");
  return { plan: row.plan, paidPlan: row.paid_plan };
}

export const giftPlanAction: AdminAction = {
  name: "gift_plan",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = giftInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID_GIFT_MESSAGE);
    const { plan } = parsed.data;
    const accountId = parsed.data.id.toLowerCase();

    const reason = (parsed.data.reason ?? "").trim();
    if (reason.length > GIFT_REASON_MAX) return fail(400, "invalid_input", LONG_REASON_MESSAGE);
    const until = parseGiftEnd(parsed.data.until);
    if (until === undefined) return fail(400, "invalid_input", BAD_END_MESSAGE);
    if (until !== null && new Date(until).getTime() <= context.deps.now().getTime()) {
      return fail(400, "invalid_input", PAST_END_MESSAGE);
    }

    const given = await looseDb(context).rpc("admin_set_gift", {
      p_account: accountId,
      p_plan: plan,
      p_until: until,
      p_reason: reason === "" ? null : reason,
      p_admin: context.actor.id,
    });
    if (given.error) throw new Error(`Giving the plan failed: ${given.error.message}`);
    if (given.data === "missing") return fail(404, "not_found", "That account doesn’t exist.");
    if (given.data !== "ok") throw new Error("Giving the plan answered something unexpected");

    const plans = await readPlans(context, accountId);
    await writeAudit(context, "gift_plan", accountId, {
      plan,
      until,
      reason: reason === "" ? null : reason,
      effective_plan: plans.plan,
      paid_plan: plans.paidPlan,
    });
    await context.deps.invalidateAccount(accountId);
    return {
      ok: true,
      status: 200,
      data: { changed: true, plan, until, effectivePlan: plans.plan, paidPlan: plans.paidPlan },
    };
  },
};

export const endGiftAction: AdminAction = {
  name: "end_gift",
  async run(context, rawInput): Promise<ActionResult> {
    const parsed = idInput.safeParse(rawInput);
    if (!parsed.success) return fail(400, "invalid_input", INVALID_GIFT_MESSAGE);
    const accountId = parsed.data.id.toLowerCase();

    const ended = await looseDb(context).rpc("admin_end_gift", { p_account: accountId });
    if (ended.error) throw new Error(`Ending the gift failed: ${ended.error.message}`);
    if (ended.data === "missing") return fail(404, "not_found", "That account doesn’t exist.");
    if (ended.data === "none") {
      // No gift held: a second click, an expiry, or an earlier call that ended it and died before its
      // audit row (the newest gift row of the account is then still the gift, not its end).
      const last = await context.deps.db
        .from("admin_audit")
        .select("action")
        .eq("account_id", accountId)
        .in("action", ["gift_plan", "end_gift"])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last.error) throw new Error(`Reading the audit log failed: ${last.error.message}`);
      if (last.data?.action === "gift_plan") {
        const plans = await readPlans(context, accountId);
        await writeAudit(context, "end_gift", accountId, {
          effective_plan: plans.plan,
          paid_plan: plans.paidPlan,
          retried: true,
        });
        await context.deps.invalidateAccount(accountId);
      }
      return { ok: true, status: 200, data: { changed: false } };
    }
    if (ended.data !== "ended") throw new Error("Ending the gift answered something unexpected");

    const plans = await readPlans(context, accountId);
    await writeAudit(context, "end_gift", accountId, {
      effective_plan: plans.plan,
      paid_plan: plans.paidPlan,
    });
    await context.deps.invalidateAccount(accountId);
    return {
      ok: true,
      status: 200,
      data: { changed: true, effectivePlan: plans.plan, paidPlan: plans.paidPlan },
    };
  },
};
