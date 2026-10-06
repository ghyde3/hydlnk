import { NextResponse, type NextRequest } from "next/server";
import { sweepExpiredGifts } from "@/lib/billing/gift-expiry";
import { isAuthorizedCron } from "@/lib/domains/cron-auth";
import { serverEnv } from "@/lib/env/server";
import { invalidateAccountPages } from "@/lib/publish/invalidate";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/cron/end-expired-gifts on the app host (M13-07): the ten-minute gift expiry. pg_cron calls
 * it through pg_net (migration 20261013000009) with `Authorization: Bearer <CRON_SECRET>`, exactly like
 * the domain sweep. It ends every gift whose end has passed (`end_expired_gifts`, which also writes the
 * system `end_gift` audit rows) and expires the cached public pages of each account, so the badge
 * follows the plan at once. Answers `{ended}`; 401 without the secret (read from the header only),
 * 500 when the sweep or any page expiry failed. Only POST is exported.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), serverEnv.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const result = await sweepExpiredGifts({
      db: createAdminSupabase(),
      invalidateAccount: invalidateAccountPages,
    });
    if (result.failed > 0) {
      console.error("[gifts] page expiry failed for", result.failed, "account(s)");
      return NextResponse.json(
        { error: "invalidate_failed", ended: result.ended },
        { status: 500, headers: NO_STORE },
      );
    }
    return NextResponse.json({ ended: result.ended }, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error("[gifts] expiry failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "sweep_failed" }, { status: 500, headers: NO_STORE });
  }
}
