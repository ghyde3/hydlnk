import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { postActionCore } from "@/lib/posts/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/pages/{id}/entries/{entryId}/publish {rev} on the app host (M16-15): makes the post's
 * saved draft live, and only that post: no other post, no page and not the design. The draft is
 * validated strictly first. The writer checks the owner and the suspension, and expires the post's
 * and the blog's cache tags.
 *
 *   200  {kind: "ok", rev, publishedAt}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin or {kind: "suspended"}; 415 expected_json
 *   404  {kind: "missing"}  another account's entry, an entry of another site, a page entry, a
 *        trashed post, an unknown or malformed id: one answer
 *   409  {kind: "conflict", currentRev}  the post was saved since; nothing changed
 *   409  {kind: "slug", message}  another live post has that slug, or it is reserved
 *   422  {kind: "invalid", message, issues}  what to fix, by field; {kind: "blocked"} (HL005)
 *   422  {kind: "invalid"}  no usable rev in the body
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id, entryId } = await params;
  try {
    return answer(
      await postActionCore(createAdminSupabase(), "publish", {
        userId: gated.userId,
        siteId: id,
        entryId,
        expectedRev: gated.body.rev,
      }),
    );
  } catch (error) {
    return failed("the post's publish", error);
  }
}
