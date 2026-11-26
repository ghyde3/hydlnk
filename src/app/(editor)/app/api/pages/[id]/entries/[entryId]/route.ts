import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { getPostCore } from "@/lib/posts/routes-core";

export const dynamic = "force-dynamic";

/**
 * GET /api/pages/{id}/entries/{entryId} on the app host (M16-13): one post of the signed-in
 * account's site with its draft, for the post editor (after a revision is restored, after Reload).
 * Post entries only, and never the published copy.
 *
 *   200  {kind: "ok", entry: {id, rev, status, hasUnpublishedChanges, draft, publishedAt, ...}}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin
 *   404  {kind: "missing"}  another account's entry, an entry of another site, a page entry, an
 *        unknown or malformed id: one answer
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id, entryId } = await params;
  try {
    return answer(await getPostCore({ userId: gated.userId, siteId: id, entryId }));
  } catch (error) {
    return failed("reading the post", error);
  }
}
