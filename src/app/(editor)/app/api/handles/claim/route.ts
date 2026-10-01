import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { appOrigin } from "@/lib/routing/urls";
import { claimHandle, type ClaimError } from "@/lib/handles/claim";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const STATUS_FOR: Record<ClaimError, number> = {
  short: 422,
  too_long: 422,
  invalid: 422,
  reserved: 422,
  taken: 409,
  page_limit: 403,
  no_account: 403,
  suspended: 403,
};

/**
 * POST /api/handles/claim {handle} on the app host: the HTTP face of the server-only claim, next
 * to the /claim page's Server Action. The owner is always the verified session user: any
 * `owner_id` (or other field) in the body is ignored, and a caller without a session gets a 401
 * and writes nothing. JSON only (the media type must be exactly application/json, not merely
 * contain it) and a cross-origin Origin header is refused, so a cross-site form or fetch cannot
 * reach it.
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
    const result = await claimHandle(user.id, handle);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: STATUS_FOR[result.error], headers: NO_STORE },
      );
    }
    return NextResponse.json({ handle: result.handle }, { status: 201, headers: NO_STORE });
  } catch (error) {
    console.error("[handles] claim failed", error);
    return NextResponse.json({ error: "claim_failed" }, { status: 500, headers: NO_STORE });
  }
}
