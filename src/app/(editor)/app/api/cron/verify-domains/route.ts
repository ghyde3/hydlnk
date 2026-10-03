import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/domains/cron-auth";
import { createDomainDeps } from "@/lib/domains/deps-server";
import { sweepPendingDomains } from "@/lib/domains/verify";
import { serverEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";
// Up to 50 domains, five at a time, a few Vercel calls each.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/cron/verify-domains on the app host (M4-15): the five-minute sweep. pg_cron calls it
 * through pg_net (migration 20261004000001) with `Authorization: Bearer <CRON_SECRET>`; it verifies
 * up to 50 pending domains created in the last 7 days, least recently checked first, through the
 * same routine and cooldown as "Check DNS now", and answers `{checked, verified}`.
 *
 * A missing or wrong secret is a 401 and changes nothing; the secret is read from the header only
 * (a `?secret=` in the URL is ignored, so it is a 401 too), compared in constant time, and is
 * never logged or echoed. GET and every other method is a 405 (only POST is exported). The route
 * lives on the app host only: the proxy answers 404 on marketing, tenant and custom hosts.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), serverEnv.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const result = await sweepPendingDomains(createDomainDeps());
    return NextResponse.json(
      { checked: result.checked, verified: result.verified },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[domains] sweep failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "sweep_failed" }, { status: 500, headers: NO_STORE });
  }
}
