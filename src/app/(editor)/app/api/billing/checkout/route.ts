import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { answer, isSameOrigin, jsonError, readFields, unauthenticated } from "@/lib/billing/http";
import { startCheckout } from "@/lib/billing/checkout";
import { readPaidPlansOpen } from "@/lib/billing/env";
import { isBillablePlan, isBillingInterval } from "@/lib/billing/prices";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/checkout on the app host (M4-06): starts a Stripe Checkout Session in
 * subscription mode for the signed-in user's account and answers 303 to its URL.
 *
 * Input is exactly `plan` (pro or studio) and `interval` (month or year). Any other field, a
 * price id or customer id included, is a 400; the price is looked up from the environment and the
 * customer is the account's own. The account is the verified session user. No session is a 401
 * with no Stripe call, and an account that already has a subscription (a paid plan, or a live
 * subscription in Stripe that the webhook has not applied yet) is a 409 `already_subscribed`.
 * With PAID_PLANS_OPEN=false every signed-in same-origin request is a 403 `plans_closed`, checked
 * before the input is read and before anything is called. This endpoint never changes the plan:
 * only the signed webhook does.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthenticated(request);
  if (!isSameOrigin(request)) return jsonError(403, "forbidden_origin");
  if (!readPaidPlansOpen()) {
    return answer(request, { ok: false, status: 403, error: "plans_closed" });
  }

  const fields = await readFields(request, ["plan", "interval"]);
  if (!fields || !isBillablePlan(fields.plan) || !isBillingInterval(fields.interval)) {
    return jsonError(400, "invalid_request", "Choose Pro or Studio, monthly or yearly.");
  }

  try {
    return answer(request, await startCheckout(user, fields.plan, fields.interval));
  } catch (error) {
    console.error("[billing] checkout failed:", error instanceof Error ? error.message : "unknown");
    return answer(request, { ok: false, status: 502, error: "stripe_unavailable" });
  }
}
