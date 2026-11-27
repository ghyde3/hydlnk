import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { UPLOAD_SITE_HEADER } from "@/lib/media/upload-site";
import { clientEnv } from "@/lib/env/client";
import type { CleanupAccess } from "@/lib/media/cleanup";
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
 * and removed images (see src/lib/media/cleanup.ts). With the `x-hl-site` header naming a site the
 * user may edit (Wave F) it works that site OWNER's queue: all of it when the user is the owner; for a
 * member only the rows that site's writes queued (team attack pass finding 1). Every call, the owner's
 * too, sees only rows queued more than the Undo window ago (re-review finding 1; `cleanupMediaFor`
 * derives the scope), so no call deletes what someone removed a moment ago and may bring back with Undo. No body: the input is the verified session user (and a site they
 * may edit), so a caller can neither name a path nor another owner; the worst a forged call does is
 * delete images of the queue it may work that no draft, published page or saved theme uses.
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
    // Wave F (A32): the `x-hl-site` header works off that site OWNER's queue when the user may edit the
    // site (a member: only that site's rows past the Undo window); a site they may not edit is 404 and
    // nothing runs.
    const site = request.headers.get(UPLOAD_SITE_HEADER);
    // No site: the user's own account-wide queue.
    let access: CleanupAccess = { actorId: user.id, ownerId: user.id, siteId: null };
    if (site !== null) {
      // Loaded on use: a request without a site never touches the access module.
      const { siteAccessFor } = await import("@/lib/access/server");
      const allowed = await siteAccessFor({
        actorId: user.id,
        siteId: site.toLowerCase(),
        need: "edit",
        source: "editor",
      });
      if (!allowed.ok) {
        return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
      }
      access = allowed.access;
    }
    const result = await cleanupMediaFor(access);
    return NextResponse.json(
      { deleted: result.deleted.length, kept: result.kept.length },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[media] cleanup failed", error);
    return NextResponse.json({ error: "cleanup_failed" }, { status: 500, headers: NO_STORE });
  }
}
