import type { NextRequest } from "next/server";
import { getLatestPosts, getSiteArchives, getTermIndex } from "@/lib/blog/published";
import { siteFor } from "@/lib/content";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { postsArchiveOf } from "@/lib/site/live";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/pages/{id}/posts/latest[?categories=a,b] on the app host (M16-07): what latest-posts
 * blocks would draw for a site the signed-in account may read (its own or one shared with it), so the editor's preview shows the real
 * list; with the categories the blocks filter by, those categories' newest posts are included.
 *
 *   200  {kind: "ok", latest, categories}   `latest` is null while the blog is off; `categories`
 *        are the Post type's categories (id and name) for the block's picker
 *   401  {kind: "unauthorized"}   403 forbidden_origin
 *   404  {kind: "missing"}   another account's site, an unknown or malformed id (one answer)
 *
 * PUBLISHED ONLY, like the live page: it calls the same public reads, so a draft, an unpublished or
 * a trashed post never appears here either. Ownership is checked first (the reads use the secret key).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    const site = await siteFor(createAdminSupabase(), { userId: gated.userId, source: "editor" }, id, "read");
    if (!site.ok) {
      return site.error === "not_found"
        ? answer({ status: 404, body: { kind: "missing" } })
        : answer({ status: 500, body: { kind: "error" } });
    }
    const siteId = site.site.id;
    const archive = postsArchiveOf((await getSiteArchives(siteId)).archives);
    if (!archive)
      return answer({ status: 200, body: { kind: "ok", latest: null, categories: [] } });
    const terms = await getTermIndex(siteId, archive.typeId);
    const categories = terms
      .filter((term) => term.taxonomy === "category")
      .map((term) => ({ id: term.id, name: term.name }));
    // `?categories=a,b`: the categories the editor's blocks filter by, each a real category of
    // this blog (anything else is dropped), so the preview lists older posts of a category too.
    const known = new Set(categories.map((category) => category.id));
    const asked = (request.nextUrl.searchParams.get("categories") ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => known.has(id));
    const latest = await getLatestPosts(siteId, archive.typeId, asked);
    return answer({ status: 200, body: { kind: "ok", latest, categories } });
  } catch (error) {
    return failed("reading the latest posts", error);
  }
}
