import { NextResponse, type NextRequest } from "next/server";
import { loadExportResponse } from "@/lib/analytics/dashboard/load";
import { parsePageFilter } from "@/lib/analytics/dashboard/page-filter";
import { parseRange } from "@/lib/analytics/dashboard/range";
import {
  EXPORT_RATE_LIMIT,
  EXPORT_RATE_WINDOW_SECONDS,
  dailyCsv,
  exportFilename,
  linksCsv,
  parseKind,
} from "@/lib/analytics/export";
import { getAppContext } from "@/lib/pages/context";
import { rateLimit } from "@/lib/rate-limit";

// Reads the session and the database on every request; an export is never cached.
export const dynamic = "force-dynamic";

const SAFE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

const STATUS: Record<string, number> = {
  plan_required: 403,
  not_found: 404,
  load_failed: 500,
};

function fail(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...SAFE_HEADERS, ...headers } },
  );
}

/**
 * GET /analytics/export?kind=daily|links&range=7|30|90|365 on the app host (M9-26): the Analytics
 * screen's numbers for the range as a CSV file, for the signed-in user's current page only (the same
 * rule as the screen and `/analytics/stats`: the `hl-page` cookie is a preference among their own
 * pages). The query string carries no page, owner or user id, and none is read: `?page=`,
 * `?pageId=`, `?owner=` and `?user=` change nothing. The one narrowing parameter is `?filter=all|home|<page id>` (M11-09): which page of the owner's own site the numbers are for, never which site. The plan limit is enforced by the loader on the
 * server: a Free account asking for 90 days or a year gets 403 `plan_required` and no data.
 *
 * Signed out is 401 JSON, never a redirect; any method but GET is 405; an unknown `kind` is 400; the
 * 21st request of one user in a minute is 429 with `Retry-After` (a limiter that cannot answer lets
 * the request through). The file name and every header are made here from the page's handle and the
 * range's own days, never from the request.
 */
export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof getAppContext>>;
  try {
    context = await getAppContext();
  } catch (error) {
    // The gate redirects a signed-out visitor (or an account with no page); an API says 401.
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return fail("unauthorized", 401);
    }
    console.error("[analytics] reading the app context failed", error);
    return fail("load_failed", 500);
  }

  const kind = parseKind(request.nextUrl.searchParams.get("kind"));
  if (kind === null) return fail("bad_kind", 400);

  const limit = await rateLimit(
    `analytics-export:${context.user.id}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return fail("rate_limited", 429, { "Retry-After": String(Math.max(1, limit.retryAfter)) });
  }

  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const result = await loadExportResponse({
    ownerId: context.user.id,
    pageId: context.current.id,
    range,
    page: parsePageFilter(request.nextUrl.searchParams.get("filter")),
  });
  if (!result.ok) return fail(result.error, STATUS[result.error] ?? 500);

  const body = kind === "daily" ? dailyCsv(result.days, result.pageLabel) : linksCsv(result.links);
  const filename = exportFilename(
    context.current.handle,
    kind,
    result.window.start,
    result.window.end,
  );
  return new Response(body, {
    status: 200,
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Every other method is refused (Next.js would otherwise answer HEAD from GET and OPTIONS itself).
const notAllowed = () => fail("method_not_allowed", 405, { Allow: "GET" });
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
export const HEAD = notAllowed;
export const OPTIONS = notAllowed;
