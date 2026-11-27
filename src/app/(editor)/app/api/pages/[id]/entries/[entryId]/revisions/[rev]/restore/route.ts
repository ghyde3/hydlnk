import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { PAGE_OR_POST, restorePageRevisionWithClient } from "@/lib/site-pages/entry-revisions-core";
import { readEntrySaveBody } from "@/lib/site-pages/entry-save-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** The body is `{rev}` and nothing else: anything larger is refused before it is read. */
const MAX_BODY_BYTES = 1024;

/**
 * POST /api/pages/{id}/entries/{entryId}/revisions/{rev}/restore {rev: <expected entry rev>} on the
 * app host (M15-10): saves revision `{rev}`'s snapshot as the DRAFT of one page of the signed-in
 * account's site. It publishes nothing and expires no cache tag: the page goes live when the owner
 * publishes it.
 *
 *   200  {kind: "ok", rev, unchanged}
 *   401  {kind: "unauthorized"}; 403 forbidden_origin or {kind: "suspended"}; 415 expected_json
 *   404  {kind: "missing"}  another account's entry, an entry not in site {id}, not a page entry,
 *        an unknown revision: one answer
 *   409  {kind: "conflict", currentRev}  the page was saved since; nothing changed
 *   the rest as the draft save route (422 {kind: "blocked"} for a revision that links to a site
 *   blocked since, 413, 403 {kind: "storage-full"})
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string; rev: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ kind: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: NO_STORE });
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "expected_json" }, { status: 415, headers: NO_STORE });
  }
  const read = await readEntrySaveBody(request, MAX_BODY_BYTES);
  if (!read.ok && read.reason === "too_large") {
    return NextResponse.json({ kind: "too-large" }, { status: 413, headers: NO_STORE });
  }
  if (!read.ok || !read.value || typeof read.value !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  const body = read.value as { rev?: unknown };

  const { id, entryId, rev } = await params;
  try {
    const out = await restorePageRevisionWithClient(createAdminSupabase(), {
      userId: user.id,
      siteId: id,
      entryId,
      typeKeys: PAGE_OR_POST,
      rev,
      expectedRev: body.rev,
    });
    return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
  } catch (error) {
    console.error("[revisions] restore failed", error);
    return NextResponse.json({ kind: "error" }, { status: 500, headers: NO_STORE });
  }
}
