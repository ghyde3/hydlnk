import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { siteSchedulesCore } from "@/lib/schedule/routes-core";

export const dynamic = "force-dynamic";

/**
 * GET /api/pages/{id}/schedules on the app host (Wave E, M20-10): the site's pages and posts that have
 * a pending or a failed schedule, `{kind: "ok", entries: {entryId: summary}}`, for the publish bar's
 * rows. Session and Origin first; another account's site answers `{kind: "missing"}`. `no-store`.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    return answer(await siteSchedulesCore({ userId: gated.userId, siteId: id }));
  } catch (error) {
    return failed("reading the site's schedules", error);
  }
}
