import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { createTermCore, listTermsCore } from "@/lib/posts/routes-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * /api/pages/{id}/terms on the app host (M16-14): the categories and tags of the blog of the
 * signed-in account's site.
 *
 * GET   200  {kind: "ok", terms}  categories, then tags, by name
 * POST {taxonomy: "category" | "tag", name, slug?, parentId?}
 *   201  {kind: "ok", term}  the slug comes from the name unless one is sent
 *   403  {kind: "limit", message}  the blog holds 500 terms (HL015), or {kind: "suspended"}
 *   409  {kind: "slug", message}  a term of that kind already has the slug
 *   422  {kind: "invalid", message}  no name, an unknown kind, a parent that is not a top-level
 *        category of this blog
 *
 * Both: 401 {kind: "unauthorized"}; 403 forbidden_origin; 404 {kind: "missing"} for another
 * account's site, an unknown or malformed id.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    return answer(await listTermsCore(createAdminSupabase(), { userId: gated.userId, siteId: id }));
  } catch (error) {
    return failed("listing the terms", error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    return answer(
      await createTermCore({
        userId: gated.userId,
        siteId: id,
        taxonomy: gated.body.taxonomy,
        name: gated.body.name,
        slug: gated.body.slug,
        parentId: gated.body.parentId,
      }),
    );
  } catch (error) {
    return failed("creating the term", error);
  }
}
