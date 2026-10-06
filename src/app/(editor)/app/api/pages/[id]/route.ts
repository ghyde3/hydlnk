import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_SUSPENDED_CODE } from "@/lib/admin/suspension";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { deletePage } from "@/lib/pages/delete-page";
import { DELETE_PAGE_MESSAGES } from "@/lib/pages/delete-page-core";
import { CURRENT_PAGE_COOKIE } from "@/lib/pages/pick";
import { appOrigin } from "@/lib/routing/urls";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * DELETE /api/pages/{id} {confirm} on the app host (M4-19): deletes one of the signed-in account's
 * pages. The one door: clients have no delete grant on `pages`, so this route deletes with the
 * secret key after checking ownership itself.
 *
 *   401  no session (nothing is deleted)
 *   403  forbidden_origin
 *   404  not_found: another account's page, an unknown id and a malformed id all read the same
 *   400  confirmation_mismatch (the typed text must equal the page's handle, checked here)
 *        or a body that is not JSON
 *   403  account_suspended (code too): a suspended owner cannot delete a page, nothing is touched
 *   502  domain_removal_failed: a custom domain could not be removed from the hosting project;
 *        the page and its domain rows are intact
 *   200  {handle, remaining, redirectTo}: `redirectTo` is "/claim" when that was the last page;
 *        the `hl-page` cookie is cleared when it named the deleted page
 *
 * The owner is always the verified session user. JSON only and no cross-origin Origin.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  let confirm: unknown;
  try {
    const body: unknown = await request.json();
    confirm = body && typeof body === "object" && "confirm" in body ? body.confirm : undefined;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  const { id } = await params;
  try {
    const result = await deletePage(user.id, id, confirm);
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          message: result.message,
          // A suspended owner gets the stable code too (M5-09).
          ...(result.error === "account_suspended" ? { code: ACCOUNT_SUSPENDED_CODE } : {}),
        },
        { status: result.status, headers: NO_STORE },
      );
    }
    const store = await cookies();
    if (store.get(CURRENT_PAGE_COOKIE)?.value === result.pageId) store.delete(CURRENT_PAGE_COOKIE);
    return NextResponse.json(
      {
        handle: result.handle,
        remaining: result.remaining,
        redirectTo: result.remaining === 0 ? "/claim" : null,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[pages] delete failed", error);
    return NextResponse.json(
      { error: "delete_failed", message: DELETE_PAGE_MESSAGES.delete_failed },
      { status: 500, headers: NO_STORE },
    );
  }
}
