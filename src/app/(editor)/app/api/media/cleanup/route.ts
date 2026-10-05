import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { cleanupMediaFor } from "@/lib/media/cleanup-admin";
import {
  CLEANUP_RATE_LIMIT,
  CLEANUP_RATE_WINDOW_SECONDS,
  cleanupRateKey,
} from "@/lib/publish/limits";
import { rateLimit } from "@/lib/rate-limit";
import { appOrigin } from "@/lib/routing/urls";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/media/cleanup on the app host (M5-14): works off the signed-in user's queue of replaced
 * and removed images (see src/lib/media/cleanup.ts). No body, no parameters: the only input is the
 * verified session user, so a caller can neither name a path nor another owner; the worst a forged
 * call does is delete the caller's own images that no draft, published page or saved theme uses.
 *
 * The editor calls it a few seconds after a draft save (past the Undo window) and the Publish action
 * calls the same function after `updateTag`. The upload route also runs it before refusing an
 * upload for lack of room. A cross-origin Origin header is refused. Answers
 * `{deleted, kept}` counts. At most 20 calls a minute per account (M11-12), then 429 `rate_limited`
 * with Retry-After; each call works on at most 25 queued paths.
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
  const limit = await rateLimit(
    cleanupRateKey(user.id),
    CLEANUP_RATE_LIMIT,
    CLEANUP_RATE_WINDOW_SECONDS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { ...NO_STORE, "Retry-After": String(Math.max(1, limit.retryAfter)) },
      },
    );
  }
  try {
    const result = await cleanupMediaFor(user.id);
    return NextResponse.json(
      { deleted: result.deleted.length, kept: result.kept.length },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[media] cleanup failed", error);
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500, headers: NO_STORE });
  }
}
