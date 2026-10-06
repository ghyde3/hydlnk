import { NextResponse, type NextRequest } from "next/server";
import { loadStatsResponse } from "@/lib/analytics/dashboard/load";
import { parsePageFilter } from "@/lib/analytics/dashboard/page-filter";
import { parseRange } from "@/lib/analytics/dashboard/range";
import type { StatsResponse } from "@/lib/analytics/dashboard/types";
import { getAppContext } from "@/lib/pages/context";

// Reads the session and the database on every request; a stats answer is never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const STATUS: Record<string, number> = {
  plan_required: 403,
  not_found: 404,
  unauthorized: 401,
  load_failed: 500,
};

/**
 * GET /analytics/stats?range=7|30|90|365&filter=all|home|<id> on the app host: the numbers the Analytics screen shows
 * when the range control changes, as JSON (`StatsResponse`). It answers for the signed-in user's
 * current page only (the same rule as the screen: the `hl-page` cookie is a preference among their
 * own pages), and a Free account asking for 90 days or a year gets 403 `plan_required` and no data.
 * Signed out is 401 JSON, never a redirect to the sign-in page.
 */
export async function GET(request: NextRequest) {
  const respond = (body: StatsResponse) =>
    NextResponse.json(body, {
      status: body.ok ? 200 : (STATUS[body.error] ?? 500),
      headers: NO_STORE,
    });

  let context: Awaited<ReturnType<typeof getAppContext>>;
  try {
    context = await getAppContext();
  } catch (error) {
    // The gate redirects a signed-out visitor (or an account with no page); an API says 401.
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return respond({ ok: false, error: "unauthorized" });
    }
    console.error("[analytics] reading the app context failed", error);
    return respond({ ok: false, error: "load_failed" });
  }

  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const page = parsePageFilter(request.nextUrl.searchParams.get("filter"));
  return respond(
    await loadStatsResponse({ ownerId: context.user.id, pageId: context.current.id, range, page }),
  );
}
