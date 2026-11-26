import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { expirePostCore } from "@/lib/posts/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/pages/{id}/entries/{entryId}/expire on the app host (M16-15): expires the post's cache
 * tags again, the retry the editor offers when an unpublish or a trash answered `cacheStale` (the
 * write stood, the expiry failed twice). Changes no content.
 *
 *   200  {kind: "ok", expired}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin
 *   404  {kind: "missing"}  another account's entry, an entry of another site, a page entry, an
 *        unknown or malformed id: one answer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id, entryId } = await params;
  try {
    return answer(
      await expirePostCore(createAdminSupabase(), { userId: gated.userId, siteId: id, entryId }),
    );
  } catch (error) {
    return failed("the post's cache expiry", error);
  }
}
