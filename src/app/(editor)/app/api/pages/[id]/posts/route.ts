import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { createPostCore, listPostsCore } from "@/lib/posts/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * /api/pages/{id}/posts on the app host (M16-12): the posts of the signed-in account's site.
 *
 * GET ?status=draft|published|trashed&term={categoryId}&q={title}&sort=updated_at|published_at&cursor
 *   200  {kind: "ok", items, nextCursor}  20 a page; with no status, everything outside the trash
 *   422  {kind: "invalid"}  an unknown status, sort, category or cursor
 *
 * POST {title?}
 *   201  {kind: "ok", id, rev}  a new draft
 *   403  {kind: "limit", message}  the plan's posts are used up (HL010: the database refuses the
 *        insert whatever the client sent), or {kind: "suspended"}
 *   422  {kind: "invalid"}  the blog is off, or the title is not a short string
 *
 * Both: 401 {kind: "unauthorized"}; 403 forbidden_origin; 404 {kind: "missing"} for another
 * account's site, an unknown or malformed id.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  try {
    return answer(
      await listPostsCore({
        userId: gated.userId,
        siteId: id,
        status: query.get("status"),
        term: query.get("term"),
        q: query.get("q"),
        sort: query.get("sort"),
        cursor: query.get("cursor"),
      }),
    );
  } catch (error) {
    return failed("listing the posts", error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    return answer(
      await createPostCore(createAdminSupabase(), {
        userId: gated.userId,
        siteId: id,
        title: gated.body.title,
      }),
    );
  } catch (error) {
    return failed("creating the post", error);
  }
}
