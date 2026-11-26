import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/domains/cron-auth";
import { serverEnv } from "@/lib/env/server";
import { runSchedules } from "@/lib/schedule/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/cron/run-schedules on the app host (Wave E, M20-04, M20-08): the one-minute tick of block
 * boundaries and scheduled publishing. pg_cron calls it through pg_net (`run_schedule_sweep`,
 * migration 20261126193000) only when a boundary or a schedule is due, with
 * `Authorization: Bearer <CRON_SECRET>`, like the other sweeps. Without the secret (read from the
 * header only, never the query string or the body) it answers 401 and runs nothing; the secret is
 * never echoed or logged. Answers `{sites, published, unpublished, failed, retried}`; 500 when a cache
 * expiry failed (the boundary is not acknowledged and is retried next tick; a publish stands and the
 * one-day backstop repairs its cache) or either half of the run failed (both always run: a failing
 * boundary sweep never holds back the scheduled publishes). Only POST is exported.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get("authorization"), serverEnv.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const result = await runSchedules();
    const body = {
      sites: result.sites,
      published: result.published,
      unpublished: result.unpublished,
      failed: result.failed,
      retried: result.retried,
    };
    // Both halves ran (runSchedules never stops one for the other); either one failing is a 500.
    if (result.sweepFailed || result.workerFailed) {
      return NextResponse.json(
        { error: "run_failed", ...body },
        { status: 500, headers: NO_STORE },
      );
    }
    if (result.sitesFailed > 0 || result.expiryFailed > 0) {
      console.error(
        "[schedule] cache expiry failed for",
        result.sitesFailed,
        "site(s) and",
        result.expiryFailed,
        "entry(ies)",
      );
      return NextResponse.json(
        { error: "invalidate_failed", ...body },
        { status: 500, headers: NO_STORE },
      );
    }
    return NextResponse.json(body, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error("[schedule] the run failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "run_failed" }, { status: 500, headers: NO_STORE });
  }
}
