import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { UPLOAD_SITE_HEADER } from "@/lib/media/upload-site";
import { isAccountSuspended, suspendedBody } from "@/lib/admin/suspension";
import { clientEnv } from "@/lib/env/client";
import { unqueueMediaPath } from "@/lib/media/cleanup-admin";
import { adminUploadQuota } from "@/lib/media/quota";
import { adminUploadRateLimit } from "@/lib/media/rate-limit";
import { processUpload } from "@/lib/media/upload";
import { appOrigin } from "@/lib/routing/urls";
import { ACCESS_LOST_MESSAGE } from "@/lib/team/messages";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/media on the app host (M2-08): the one upload route for tenant images. Multipart field
 * `file`, optional field `kind` (avatar, background or content). Answers `{path, width, height,
 * url}`; `path` is the image reference the draft stores.
 *
 * The folder (Wave F, A31): the `x-hl-site` header names the site the image is for; the access helper must say
 * the verified session user may edit it, and the file is stored in, counted on and queued for that
 * site OWNER's folder (so a member's upload is usable on the shared site and the owner's quota and
 * plan apply, T15). A site the user may not edit stores nothing (404, the one answer for a missing
 * one). Without it (an old bundle) the folder is the session user's own. Any owner or folder
 * field in the form is ignored; a caller without a session gets a 401 and nothing is stored. The
 * rate limit and the suspension check stay the uploader's (T16).
 * A cross-origin Origin header is refused, so a cross-site form cannot upload as the signed-in
 * user. Everything else (size cap, magic bytes, dimensions, storage) is `processUpload`.
 *
 * The per-account cap (M4-31) is `adminUploadQuota`: the plan is read from `accounts.plan` and the
 * bytes already stored from the bucket, and an upload past 10 MiB (Free), 100 MiB (Pro) or 1 GiB
 * (Studio) is 413 `upload_quota`. A missing or suspended account is 403.
 *
 * The image is re-encoded (M5-11, M5-12): `kind` picks a 400px square WebP (avatar) or a WebP of at
 * most 1600px (background, content), stored as `{uid}/{avatar|bg|img}-{content hash}.webp` with a
 * one-year cache-control; the original is never kept. Abuse limits (M5-13): the 21st request of one
 * user in an hour is 429 with Retry-After, an image over 40 megapixels is 422 before it is decoded.
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

  try {
    // A suspended owner cannot upload (M5-09): 403 with code account_suspended, nothing stored.
    if (await isAccountSuspended(user.id)) {
      return NextResponse.json(suspendedBody("forbidden"), { status: 403, headers: NO_STORE });
    }
    const site = request.headers.get(UPLOAD_SITE_HEADER);
    let ownerId = user.id;
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
        if (allowed.reason === "error") throw new Error("reading the site's access failed");
        if (allowed.reason === "account_suspended") {
          return NextResponse.json(suspendedBody("forbidden"), { status: 403, headers: NO_STORE });
        }
        return NextResponse.json(
          { error: "not_found", message: ACCESS_LOST_MESSAGE },
          { status: 404, headers: NO_STORE },
        );
      }
      ownerId = allowed.access.ownerId;
    }
    const result = await processUpload(request, ownerId, undefined, adminUploadQuota(ownerId), {
      rateLimit: adminUploadRateLimit(user.id),
      unqueue: (path) => unqueueMediaPath(ownerId, path),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, message: result.message },
        {
          status: result.status,
          headers:
            result.retryAfter === undefined
              ? NO_STORE
              : { ...NO_STORE, "Retry-After": String(result.retryAfter) },
        },
      );
    }
    return NextResponse.json(result.image, { status: 200, headers: NO_STORE });
  } catch (error) {
    console.error("[media] upload failed", error);
    return NextResponse.json(
      { error: "storage_failed", message: "We couldn’t save that image. Try again." },
      { status: 500, headers: NO_STORE },
    );
  }
}
