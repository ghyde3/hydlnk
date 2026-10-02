import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { clientEnv } from "@/lib/env/client";
import { adminUploadQuota } from "@/lib/media/quota";
import { processUpload } from "@/lib/media/upload";
import { appOrigin } from "@/lib/routing/urls";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * POST /api/media on the app host (M2-08): the one upload route for tenant images. Multipart field
 * `file`, optional field `kind` (avatar, background or content). Answers `{path, width, height,
 * url}`; `path` is the image reference the draft stores.
 *
 * The owner folder is always the verified session user (`getSessionUser`): any owner or folder
 * field in the form is ignored, and a caller without a session gets a 401 and nothing is stored.
 * A cross-origin Origin header is refused, so a cross-site form cannot upload as the signed-in
 * user. Everything else (size cap, magic bytes, dimensions, storage) is `processUpload`.
 *
 * The per-account cap (M4-31) is `adminUploadQuota`: the plan is read from `accounts.plan` and the
 * bytes already stored from the bucket, and an upload past 10 MiB (Free), 100 MiB (Pro) or 1 GiB
 * (Studio) is 413 `upload_quota`. A missing or suspended account is 403.
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
    const result = await processUpload(request, user.id, undefined, adminUploadQuota(user.id));
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, message: result.message },
        { status: result.status, headers: NO_STORE },
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
