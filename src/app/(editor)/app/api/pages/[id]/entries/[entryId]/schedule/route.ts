import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { cancelScheduleCore, getSchedulesCore, scheduleCore } from "@/lib/schedule/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * /api/pages/{id}/entries/{entryId}/schedule on the app host (Wave E, M20-07, M20-09, M20-10): a page
 * or a post of the site, scheduled to publish (the saved draft at `rev`, checked now as Publish would)
 * or to unpublish. Session, Origin and JSON are checked first (`gate`); nothing here changes what is
 * live. Every answer is `no-store`.
 *
 *   GET     200 {kind: "ok", rev, schedules}
 *   POST    {rev, action, runAt} -> 200 {kind: "ok", schedule}
 *   DELETE  {rev, action}        -> 200 {kind: "ok", canceled}
 *   401 unauthorized; 403 forbidden_origin, {kind: "suspended"}, {kind: "plan"} (HL017),
 *   {kind: "limit"} (HL018); 404 {kind: "missing"} (another account's entry, another site's, a
 *   trashed one, an unknown id: one answer); 409 {kind: "conflict", currentRev}; 400 {kind: "time"};
 *   415 expected_json; 422 {kind: "invalid", issues, errors?} or {kind: "blocked"}.
 */
type Params = { params: Promise<{ id: string; entryId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id, entryId } = await params;
  try {
    return answer(await getSchedulesCore(createAdminSupabase(), { userId: gated.userId, siteId: id, entryId }));
  } catch (error) {
    return failed("reading the schedules", error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id, entryId } = await params;
  try {
    return answer(
      await scheduleCore(createAdminSupabase(), {
        userId: gated.userId,
        siteId: id,
        entryId,
        body: gated.body,
      }),
    );
  } catch (error) {
    return failed("scheduling", error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id, entryId } = await params;
  try {
    return answer(
      await cancelScheduleCore(createAdminSupabase(), {
        userId: gated.userId,
        siteId: id,
        entryId,
        body: gated.body,
      }),
    );
  } catch (error) {
    return failed("cancelling a schedule", error);
  }
}
