import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { deleteTermCore, renameTermCore } from "@/lib/posts/routes-core";

export const dynamic = "force-dynamic";

/**
 * /api/pages/{id}/terms/{termId} on the app host (M16-14): one category or tag of the signed-in
 * account's site.
 *
 * PATCH {name?, slug?}   200 {kind: "ok", term}; 409 {kind: "slug", message}; 422 {kind: "invalid"}
 * DELETE                 200 {kind: "ok", id}  the posts stay; a child category becomes top-level
 *
 * Both: 401 {kind: "unauthorized"}; 403 forbidden_origin or {kind: "suspended"}; 404
 * {kind: "missing"} for another account's site or term, a term of another site, an unknown or
 * malformed id: one answer.
 */
type Context = { params: Promise<{ id: string; termId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id, termId } = await params;
  try {
    return answer(
      await renameTermCore({
        userId: gated.userId,
        siteId: id,
        termId,
        name: gated.body.name,
        slug: gated.body.slug,
      }),
    );
  } catch (error) {
    return failed("renaming the term", error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  const gated = await gate(request, "none");
  if (!gated.ok) return gated.response;
  const { id, termId } = await params;
  try {
    return answer(await deleteTermCore({ userId: gated.userId, siteId: id, termId }));
  } catch (error) {
    return failed("deleting the term", error);
  }
}
