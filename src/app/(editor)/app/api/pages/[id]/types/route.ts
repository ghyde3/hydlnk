import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { listTypesCore } from "@/lib/posts/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/pages/{id}/types on the app host (M16-02, M16-12): the content types of the signed-in
 * account's site, on or off, and how many posts it holds against the plan.
 *
 *   200  {kind: "ok", types, usage: {posts, limit}}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin
 *   404  {kind: "missing"}  another account's site, an unknown or malformed id: one answer
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    return answer(await listTypesCore(createAdminSupabase(), { userId: gated.userId, siteId: id }));
  } catch (error) {
    return failed("listing the types", error);
  }
}
