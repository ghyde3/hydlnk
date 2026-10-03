import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ACCOUNT_SUSPENDED_CODE } from "@/lib/admin/suspension";
import { clientEnv } from "@/lib/env/client";
import { createPage } from "@/lib/pages/create-page";
import { CREATE_FAILED_MESSAGE } from "@/lib/pages/create-page-core";
import { CURRENT_PAGE_COOKIE } from "@/lib/pages/pick";
import { appOrigin, protocolFor } from "@/lib/routing/urls";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * POST /api/pages {handle} on the app host (M4-18): creates another page for the signed-in account.
 * The one door: clients cannot insert into `pages` (no grant), so this route inserts with the secret
 * key after the checks below, and the database trigger enforces the plan's page limit whatever this
 * code does.
 *
 *   401  no session (nothing is written)
 *   403  forbidden_origin, or `page_limit` ("Free includes 1 page. Pro includes 3.", "You’ve used 3
 *        of 3 pages. Studio includes 15.", "You’ve used 15 of 15 pages."), or a blocked account
 *   409  taken        422  short, too_long, invalid, reserved    400/415  not JSON {handle}
 *   201  {pageId, handle}, and the `hl-page` cookie now names the new page
 *
 * The owner is always the verified session user: any `owner_id` or other field in the body is
 * ignored. JSON only and no cross-origin Origin, like /api/handles/claim.
 */
export async function POST(request: NextRequest) {
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
  let handle = "";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "handle" in body && typeof body.handle === "string") {
      handle = body.handle;
    }
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await createPage(user.id, handle);
    if (!result.ok) {
      // A suspended owner also gets the stable `code` (M5-09); `error` keeps its older word.
      return NextResponse.json(
        {
          error: result.error,
          message: result.message,
          ...(result.error === "suspended" ? { code: ACCOUNT_SUSPENDED_CODE } : {}),
        },
        { status: result.status, headers: NO_STORE },
      );
    }
    // Same cookie as the page switcher's selectPage: host-only (no Domain), so tenant hosts never
    // receive it.
    (await cookies()).set(CURRENT_PAGE_COOKIE, result.pageId, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: protocolFor(clientEnv.NEXT_PUBLIC_ROOT_DOMAIN) === "https",
      maxAge: ONE_YEAR_SECONDS,
    });
    return NextResponse.json(
      { pageId: result.pageId, handle: result.handle },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[pages] create failed", error);
    return NextResponse.json(
      { error: "create_failed", message: CREATE_FAILED_MESSAGE },
      { status: 500, headers: NO_STORE },
    );
  }
}
