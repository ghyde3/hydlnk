import type { NextRequest } from "next/server";
import { answer, failed, gate } from "@/lib/posts/route-http";
import { setPostTypeCore } from "@/lib/posts/routes-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/pages/{id}/types/post {enabled?, archivePath?} on the app host (M16-02): turns the blog
 * of the signed-in account's site on or off, or moves its archive. Turning it off deletes nothing.
 * The writer checks the owner and the suspension, and expires the type and the site.
 *
 *   200  {kind: "ok", type}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin or {kind: "suspended"}; 415 expected_json
 *   404  {kind: "missing"}  another account's site, an unknown or malformed id
 *   409  {kind: "path", message}  the address is used by a page or reserved (HL012)
 *   422  {kind: "invalid", message}
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(request, "json");
  if (!gated.ok) return gated.response;
  const { id } = await params;
  try {
    return answer(
      await setPostTypeCore({
        userId: gated.userId,
        siteId: id,
        enabled: gated.body.enabled,
        archivePath: gated.body.archivePath,
      }),
    );
  } catch (error) {
    return failed("changing the blog", error);
  }
}
