import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_SUSPENDED_CODE } from "@/lib/admin/suspension";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { createSubPage, SUB_PAGE_MESSAGES } from "@/lib/site-pages/sub-pages";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/pages/{id}/sub-pages {title?, path?} on the app host (M11-04, M11-08): adds a page to
 * the signed-in account's site `id`. The one door: clients have no insert grant on `site_pages`, so
 * this route inserts with the secret key after checking ownership itself, and the database trigger
 * enforces the plan's pages per site whatever this code does.
 *
 *   401  no session (nothing is written)
 *   403  forbidden_origin, `page_limit` (the plan's message, HL008), or `account_suspended` (code too)
 *   404  not_found: another account's site, an unknown id and a malformed id all read the same
 *   409  path_taken      422  path_invalid (the rule or the reserved list)
 *   400/415  not JSON
 *   201  {id, draft, createdAt}: the title is "New page" unless given and the path is suggested from
 *        it against the site's other paths unless one is given
 *
 * The owner is always the verified session user. JSON only and no cross-origin Origin.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: NO_STORE });
  }
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return NextResponse.json({ error: "expected_json" }, { status: 415, headers: NO_STORE });
  }
  let title: unknown;
  let path: unknown;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") {
      title = "title" in body ? body.title : undefined;
      path = "path" in body ? body.path : undefined;
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  try {
    const result = await createSubPage(user.id, id, { title, path });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          message: result.message,
          ...(result.error === "account_suspended" ? { code: ACCOUNT_SUSPENDED_CODE } : {}),
        },
        { status: result.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { id: result.id, draft: result.draft, createdAt: result.createdAt },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[site-pages] create failed", error);
    return NextResponse.json(
      { error: "create_failed", message: SUB_PAGE_MESSAGES.create_failed },
      { status: 500, headers: NO_STORE },
    );
  }
}
