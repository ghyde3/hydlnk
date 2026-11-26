import { NextResponse, type NextRequest } from "next/server";
import { loadAudienceExport } from "@/lib/forms/audience";
import { parseFormFilter } from "@/lib/forms/contract";
import {
  AUDIENCE_EXPORT_RATE_LIMIT,
  AUDIENCE_EXPORT_RATE_WINDOW_SECONDS,
  audienceCsv,
  audienceFilename,
} from "@/lib/forms/export";
import { getAppContext } from "@/lib/pages/context";
import { rateLimit } from "@/lib/rate-limit";

// Reads the session and the database on every request; an export is never cached.
export const dynamic = "force-dynamic";

const SAFE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

function fail(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(
    { ok: false, error },
    { status, headers: { ...SAFE_HEADERS, ...headers } },
  );
}

/**
 * GET /audience/export?form=all|{blockId} on the app host (M17-09): the current site's submissions
 * as a CSV file, on every plan. The site is the signed-in user's current one (`getAppContext`); the
 * rows are read with their session under RLS; `?site=`, `?owner=` and `?user=` are never read.
 * Signed out is 401 JSON, a `form` that is neither "all" nor a block id is 400, the 21st export of a
 * user in a minute is 429 with Retry-After, any other method 405. Newest first, at most the newest
 * 50,000 rows. The file name comes from the handle and the day.
 */
export async function GET(request: NextRequest) {
  let context: Awaited<ReturnType<typeof getAppContext>>;
  try {
    context = await getAppContext();
  } catch (error) {
    const digest = (error as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      return fail("unauthorized", 401);
    }
    console.error("[audience] reading the app context failed");
    return fail("load_failed", 500);
  }

  const form = parseFormFilter(request.nextUrl.searchParams.get("form"));
  if (form === null) return fail("bad_form", 400);

  const limit = await rateLimit(
    `audience-export:${context.user.id}`,
    AUDIENCE_EXPORT_RATE_LIMIT,
    AUDIENCE_EXPORT_RATE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return fail("rate_limited", 429, { "Retry-After": String(Math.max(1, limit.retryAfter)) });
  }

  let file: Awaited<ReturnType<typeof loadAudienceExport>>;
  try {
    file = await loadAudienceExport({ siteId: context.current.id, form });
  } catch (error) {
    console.error("[audience] the export failed:", error instanceof Error ? error.message : "");
    return fail("load_failed", 500);
  }
  return new Response(audienceCsv(file.rows, file.labels), {
    status: 200,
    headers: {
      ...SAFE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${audienceFilename(context.current.handle, new Date())}"`,
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
