import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_SUSPENDED_CODE } from "@/lib/admin/suspension";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { deleteSubPage, SUB_PAGE_MESSAGES } from "@/lib/site-pages/sub-pages";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * DELETE /api/pages/{id}/sub-pages/{subId} on the app host (M11-04, M11-08): deletes one page of the
 * signed-in account's site. Immediate, like deleting a site: the page leaves the live site now (its
 * menu entry and the page links to it render nothing), and its id leaves Home's draft menu. The one
 * door: clients have no delete grant on `site_pages`.
 *
 *   401  no session (nothing is deleted)
 *   403  forbidden_origin, or `account_suspended` (code too)
 *   404  not_found: another account's site or page, an unknown id and a malformed id all read the same
 *   200  {id}
 *
 * The owner is always the verified session user.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== appOrigin(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers: NO_STORE });
  }

  const { id, subId } = await params;
  try {
    const result = await deleteSubPage(user.id, id, subId);
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
    return NextResponse.json({ id: result.id }, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error("[site-pages] delete failed", error);
    return NextResponse.json(
      { error: "delete_failed", message: SUB_PAGE_MESSAGES.delete_failed },
      { status: 500, headers: NO_STORE },
    );
  }
}
