import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { saveEntryDraftWithClient } from "@/lib/site-pages/entry-save-core";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/pages/{id}/entries/{entryId}/draft {rev, draft} on the app host (1b1-16): saves the draft
 * of one page entry of the signed-in account's site, Home's blocks or a sub-page. The one door for
 * the editor's autosave; the secret-key client writes after the writer checks ownership.
 *
 *   200  {kind: "ok", rev, unchanged}
 *   401  no session; 403 forbidden_origin or {kind: "suspended"}; 404 {kind: "missing"} (another
 *        account's entry, an unknown or mismatched id)
 *   409  {kind: "conflict", currentRev}  nothing changed
 *   413  {kind: "too-large"}; 403 {kind: "storage-full"}; 422 {kind: "blocked"} (HL005),
 *        {kind: "invalid"}; 409 {kind: "path"} (HL012)
 */
export async function POST(
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
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "expected_json" }, { status: 415, headers: NO_STORE });
  }
  let body: { rev?: unknown; draft?: unknown };
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    body = parsed as { rev?: unknown; draft?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  const { id, entryId } = await params;
  try {
    const out = await saveEntryDraftWithClient(createAdminSupabase(), {
      userId: user.id,
      siteId: id,
      entryId,
      expectedRev: body.rev,
      draft: body.draft,
    });
    return NextResponse.json(out.body, { status: out.status, headers: NO_STORE });
  } catch (error) {
    console.error("[entries] save failed", error);
    return NextResponse.json({ kind: "error" }, { status: 500, headers: NO_STORE });
  }
}
