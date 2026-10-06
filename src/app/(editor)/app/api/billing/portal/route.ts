import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { answer, isSameOrigin, jsonError, readFields, unauthenticated } from "@/lib/billing/http";
import { openPortal } from "@/lib/billing/portal";
import { isDowngradeTarget, isPortalIntent } from "@/lib/billing/prices";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal on the app host (M4-07): opens a Stripe billing-portal session for the
 * signed-in user's own customer and answers 303 to its URL.
 *
 * Input is `intent` (manage, switch_yearly, upgrade_studio or downgrade) and, for a downgrade
 * only, an optional `to` (free or pro). Any other field is a 400: a customer id or price id from
 * the request is never read. The customer is the one stored on the account that owns the verified
 * session; an account with none gets a 409 and no Stripe call. Returning from the portal changes
 * nothing here: only the signed webhook changes the plan.
 */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return unauthenticated(request);
  if (!isSameOrigin(request)) return jsonError(403, "forbidden_origin");

  const fields = await readFields(request, ["intent", "to"]);
  if (
    !fields ||
    !isPortalIntent(fields.intent) ||
    (fields.to !== undefined && (fields.intent !== "downgrade" || !isDowngradeTarget(fields.to)))
  ) {
    return jsonError(400, "invalid_request", "Unknown billing action.");
  }

  try {
    const to = fields.to !== undefined && isDowngradeTarget(fields.to) ? fields.to : undefined;
    return answer(request, await openPortal(user, fields.intent, to), "portal");
  } catch (error) {
    console.error("[billing] portal failed:", error instanceof Error ? error.message : "unknown");
    return answer(request, { ok: false, status: 502, error: "stripe_unavailable" }, "portal");
  }
}
