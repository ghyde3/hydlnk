import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { listPageRevisionsWithClient } from "@/lib/site-pages/entry-revisions-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * GET /api/pages/{id}/entries/{entryId}/revisions on the app host (M15-10): the revisions of one
 * page of the signed-in account's site, Home's or a sub-page's, newest first. No snapshot is sent:
 * each row is `{rev, wasPublished, source, createdAt}`.
 *
 *   200  {kind: "ok", revisions}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin
 *   404  {kind: "missing"}  another account's entry, an entry of another site, a post, a trashed
 *        page, an unknown or malformed id: one answer
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ kind: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: NO_STORE });
  }
  const { id, entryId } = await params;
  try {
    const out = await listPageRevisionsWithClient(createAdminSupabase(), {
      userId: user.id,
      siteId: id,
      entryId,
    });
    return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
  } catch (error) {
    console.error("[revisions] list failed", error);
    return NextResponse.json({ kind: "error" }, { status: 500, headers: NO_STORE });
  }
}
